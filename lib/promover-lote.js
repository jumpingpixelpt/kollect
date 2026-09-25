import { internalHeaders } from "@/lib/internal-fetch";

/**
 * PROMOÇÃO EM LOTE, conduzida por cron — o motor de /api/cron/importar-top.
 *
 * Porque não é o /api/promote?n=: esse lote foi escrito para um clique no browser, e tem
 * três buracos quando quem chama é um cron que se sobrepõe a si próprio de 4 em 4 minutos:
 *  1. Não há claim. Duas invocações a correr ao mesmo tempo lêem os mesmos "top N" e pagam
 *     o Apify duas vezes pelo mesmo perfil. Aqui cada prospect é reclamado com um update
 *     condicional (status = o que se leu) — quem perde a corrida salta.
 *  2. Falha não é terminal. No caminho com handle, um perfil que falha fica com o status
 *     com que entrou e volta a ser o "top" na chamada seguinte, para sempre. Aqui a falha
 *     grava `falha_promocao:<motivo>`, que o filtro não apanha; a repescagem é decisão
 *     humana, em /descobertas.
 *  3. Handle já no radar. `ingest_profile` faz upsert por handle (UNIQUE, sem plataforma) e
 *     as rotas de promoção apagam e reinserem os vídeos do creator — re-promover quem já
 *     está na base DESTRÓI as transcrições e análises dele. Aqui quem já existe em
 *     `creators` leva `ja_no_radar:<data>` e não custa nada; e dois prospects com o mesmo
 *     handle (a mesma pessoa descoberta no IG e no TikTok) só promovem um — o outro fica
 *     `duplicado_handle:<tubular_id do promovido>`.
 *
 * A promoção em si continua a ser das rotas por plataforma (promote-apify / promote-tiktok),
 * e a cadeia de enriquecimento corre DENTRO delas (promote-tiktok com ?enrich=1): a invocação
 * do cron pode morrer aos 300 s a meio de uma vaga, e o que já foi pedido a uma rota irmã
 * continua sozinho. Este módulo só escolhe, reclama e regista.
 *
 * `semConteudo`: o enrich corre com ?conteudo=0 (sem deep-scan). Numa importação de
 * centenas o Gemini File API fecha ao fim de ~300 análises/dia (medido a 04/08/2026) e cada
 * tentativa depois disso paga o Apify para nada. O drain fica para /api/cron/deep-scan-lote.
 *
 * Corta-circuito POR PLATAFORMA: três falhas seguidas de uma plataforma param essa plataforma
 * na vaga, e o cron deixa de a pedir (fica só a outra). Uma falha sistémica — Bearer errado,
 * APIFY_TOKEN em falta, o actor do TikTok a recusar — responde em milissegundos, e sem isto
 * marcava a fila inteira como falhada a 20 por invocação. Na 1ª vaga (11/09/2026) foi
 * exactamente isso: 4 TikToks falhados no Apify em 68 s, com o Instagram a correr bem.
 */
const STALE_MS = 25 * 60 * 1000; // claim mais velho do que isto = a invocação morreu; pode retomar-se
const FALHAS_SEGUIDAS_MAX = 3;
const JUNK = new Set(["p", "reel", "reels", "stories", "explore"]);

// Os status que ainda são "por promover". `promovendo*` entra só para repescar claims mortos.
// Exportado para o progresso do cron contar a fila com a MESMA definição.
export const OR_PROMOVIVEIS = [
  "status.eq.novo", "status.eq.tubular:reprocessado", "status.like.*apify_reprocessado",
  "status.like.vids*", "status.like.handle*", "status.like.promovendo:*",
].join(",");

export function claimVelho(status, agoraMs) {
  if (!status?.startsWith("promovendo:")) return false;
  const t = Date.parse(status.slice("promovendo:".length));
  return !Number.isFinite(t) || agoraMs - t > STALE_MS;
}

// Handles no radar, completos ou nada: o fetchAllRows genérico engole erros de página e
// devolveria um conjunto parcial — e um "desconhecido" falso aqui é um creator destruído.
async function handlesNoRadar(db) {
  const out = new Set();
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from("creators").select("handle").not("handle", "is", null).order("handle").range(from, from + size - 1);
    if (error) throw new Error(`creators: ${error.message}`);
    for (const c of data || []) out.add(c.handle.trim().toLowerCase());
    if (!data || data.length < size) break;
  }
  const { count, error } = await db.from("creators").select("id", { count: "exact", head: true }).not("handle", "is", null);
  if (error || count == null || count !== out.size) throw new Error(`handles no radar incompletos (${out.size} lidos, ${count ?? "?"} na base) — vaga abortada`);
  return out;
}

/** Candidatos por ordem de mini-score, já sem quem está no radar. Só leitura — serve o dry-run. */
export async function candidatos(db, { mmin, limite = 40, genre = null, plataforma = null }) {
  const known = await handlesNoRadar(db);
  let q = db.from("prospects").select("tubular_id, name, handle, platform, mini_score, status, followers, genre")
    .not("handle", "is", null).gte("mini_score", mmin).or(OR_PROMOVIVEIS);
  if (genre) q = q.eq("genre", genre);
  if (plataforma) q = q.eq("platform", plataforma);
  // pede mais do que o limite: os "já no radar", os claims vivos e os duplicados saem pelo caminho
  const { data, error } = await q.order("mini_score", { ascending: false }).order("tubular_id").limit(limite * 3);
  if (error) throw new Error(`prospects: ${error.message}`);
  const agora = Date.now();
  const lista = [], jaNoRadar = [], lixo = [], duplicados = [];
  const vistos = new Map(); // handle minúsculo -> prospect que ficou com ele nesta leitura
  for (const p of data || []) {
    const h = p.handle.trim().toLowerCase();
    if (p.status?.startsWith("promovendo:") && !claimVelho(p.status, agora)) continue; // outra invocação está nele
    if (JUNK.has(h)) { lixo.push(p); continue; }
    if (known.has(h)) { jaNoRadar.push(p); continue; }
    if (vistos.has(h)) { duplicados.push({ ...p, vencedor: vistos.get(h).tubular_id }); continue; }
    vistos.set(h, p);
    if (lista.length < limite) lista.push(p);
  }
  return { lista, jaNoRadar, lixo, duplicados, lidos: (data || []).length };
}

/**
 * Corre uma vaga: reclama e promove até `conc` prospects em paralelo, sem arrancar novos
 * depois de `orcamentoMs`. Devolve o que fez; os contadores globais ficam para quem chama,
 * que os tira da base (a invocação pode morrer a meio e o que está em memória perde-se).
 */
export async function promoverLote(db, { base, mmin, genre = null, plataforma = null, conc = 5, orcamentoMs = 120000, semConteudo = true }) {
  const t0 = Date.now();
  const hoje = new Date().toISOString().slice(0, 10);
  const { lista, jaNoRadar, lixo, duplicados } = await candidatos(db, { mmin, genre, plataforma, limite: conc * 4 });

  // custo zero, mas tira-os da fila para sempre — e diz porquê em /descobertas
  for (const p of jaNoRadar) await db.from("prospects").update({ status: `ja_no_radar:${hoje}` }).eq("tubular_id", p.tubular_id).eq("status", p.status);
  for (const p of lixo) await db.from("prospects").update({ status: "sem_handle:lixo" }).eq("tubular_id", p.tubular_id).eq("status", p.status);
  for (const p of duplicados) await db.from("prospects").update({ status: `duplicado_handle:${p.vencedor}` }).eq("tubular_id", p.tubular_id).eq("status", p.status);

  const out = [];
  const seguidas = {};  // plataforma -> falhas seguidas
  const travadas = {};  // plataforma -> motivo do corta-circuito
  let i = 0;
  async function worker() {
    while (true) {
      if (Date.now() - t0 > orcamentoMs) break;
      const p = lista[i++];
      if (!p) break;
      if (travadas[p.platform]) { out.push({ handle: p.handle, ok: null, saltado: `plataforma ${p.platform} travada nesta vaga` }); continue; }

      // o radar pode ter mudado desde a leitura (outra vaga, um "Avaliar perfil" na app)
      // eq e não ilike: `_` é curinga do LIKE e metade dos handles tem underscore
      const { data: existe } = await db.from("creators").select("id").eq("handle", p.handle.trim()).limit(1);
      if (existe?.length) {
        await db.from("prospects").update({ status: `ja_no_radar:${hoje}` }).eq("tubular_id", p.tubular_id).eq("status", p.status);
        out.push({ handle: p.handle, ok: null, saltado: "já no radar" });
        continue;
      }
      // claim condicional: só quem vê o status que leu ganha o prospect
      const claim = `promovendo:${new Date().toISOString()}`;
      const { data: ganho } = await db.from("prospects").update({ status: claim }).eq("tubular_id", p.tubular_id).eq("status", p.status).select("tubular_id");
      if (!ganho?.length) { out.push({ handle: p.handle, ok: null, saltado: "reclamado por outra invocação" }); continue; }

      const r = { handle: p.handle, platform: p.platform, mini: p.mini_score };
      const h = encodeURIComponent(p.handle.trim()), tid = encodeURIComponent(p.tubular_id);
      const url = p.platform === "tiktok"
        ? `${base}/api/promote-tiktok?handle=${h}&tubular_id=${tid}&enrich=1${semConteudo ? "&sem_conteudo=1" : ""}`
        : `${base}/api/promote-apify?tubular_id=${tid}&handle=${h}${semConteudo ? "&sem_conteudo=1" : ""}`;
      let j = null, transporte = null;
      try {
        const resp = await fetch(url, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(290000) });
        const txt = await resp.text();
        try { j = JSON.parse(txt); } catch { transporte = `resposta não-JSON (HTTP ${resp.status})`; }
      } catch (e) { transporte = `rede/timeout: ${String(e).slice(0, 60)}`; }

      if (j && (j.ok || j.creator_id)) {
        r.ok = true; r.creator_id = j.creator_id; r.enrich = j.enrich?.resumo ?? null;
        seguidas[p.platform] = 0;
        // a rota já gravou `promovido`; garante-o se ela morreu antes (o creator existe)
        await db.from("prospects").update({ status: "promovido" }).eq("tubular_id", p.tubular_id).like("status", "promovendo:%");
      } else if (transporte) {
        // Falha de transporte, não do perfil: o claim fica, expira em 25 min e o prospect volta
        // à fila. A rota irmã pode até estar a terminar sozinha — se gravar `promovido`, ganha.
        r.ok = false; r.motivo = transporte; r.retentavel = true;
        seguidas[p.platform] = (seguidas[p.platform] || 0) + 1;
      } else {
        // `detalhe` é a resposta real da API externa (o status do Apify, o corpo do erro) — sem
        // ele o status dizia só "perfil TikTok falhou no Apify" e ninguém sabia porquê.
        const det = j?.detalhe ? ` — ${String(j.detalhe)}` : "";
        r.ok = false; r.motivo = `${String(j?.error || j?.fatal || "falhou sem motivo")}${det}`.slice(0, 220);
        seguidas[p.platform] = (seguidas[p.platform] || 0) + 1;
        // Terminal para o lote. A rota já substituiu o claim pelo status dela (apify:perfil_vazio,
        // apify:homonima_suspeita…); o motivo aqui traz esse texto, e é este status que o
        // progresso conta. Nunca por cima de um `promovido` (a rota pode ter acabado entretanto).
        await db.from("prospects").update({ status: `falha_promocao:${r.motivo.slice(0, 200)}` }).eq("tubular_id", p.tubular_id).neq("status", "promovido");
      }
      out.push(r);
      if ((seguidas[p.platform] || 0) >= FALHAS_SEGUIDAS_MAX && !travadas[p.platform]) travadas[p.platform] = `${FALHAS_SEGUIDAS_MAX} falhas seguidas — última: ${r.motivo}`;
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, lista.length)) }, worker));
  return {
    promovidos: out.filter((o) => o.ok === true).length,
    falhas: out.filter((o) => o.ok === false && !o.retentavel).length,
    retentaveis: out.filter((o) => o.retentavel).length,
    ja_no_radar: jaNoRadar.length + out.filter((o) => o.saltado === "já no radar").length,
    duplicados: duplicados.length,
    lixo: lixo.length,
    travadas: Object.keys(travadas).length ? travadas : null,
    segundos: Math.round((Date.now() - t0) / 1000),
    detalhes: out,
  };
}
