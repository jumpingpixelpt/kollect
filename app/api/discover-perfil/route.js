import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { funnelMiniScore } from "@/lib/score";
import { engRateViews } from "@/lib/engagement";
import { territorio, CHAVES } from "@/lib/territorios";
import { tubularFetch, podeGastar, PISO } from "@/lib/tubular-quota";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Descoberta B — POR PERFIL, pela Tubular (v4/creator.search).
 *
 * A Descoberta A (/api/discover-tubular) pergunta "quem PUBLICOU sobre isto nesta janela?"
 * ao v3/video.search e paga por vídeo devolvido — em unidades E no teto mensal de 100.000
 * vídeos únicos, que a importação de cabelo de 03/09 esgotou até 01/10. Esta pergunta
 * "quem É brasileiro, do género, nesta banda de seguidores, e activo?" ao v4/creator.search,
 * que só gasta unidades: o teto dos vídeos não lhe toca.
 *
 * Sondado a 04/09/2026 (diferencial: a mesma query com e sem cada filtro):
 *   - os filtros FUNCIONAM — countries, genres (ids inteiros), types, platforms,
 *     performance.followers / last_upload / followers_growth (fraccional), rising_star. A
 *     conclusão de 28/07 ("o creator.search não tem filtros") vinha de nomes de chave
 *     errados, que o endpoint ignora em silêncio com HTTP 200;
 *   - custo por linha devolvida: 5 só com ids; +5 `snippet` (nome, foto); +5
 *     `account_snippet` (URL da conta por plataforma — o @, sem Apify); +10
 *     `account_performance` (seguidores, crescimento a 30 dias, último post, uploads, POR
 *     plataforma). Depois o creator.monthly_trends gradua a 0,1, como na A;
 *   - universo BR · Beauty · influencer · 3k–500k = 20.710; com post nos últimos 30 dias,
 *     14.641. No topo por views 82% já estavam em prospects — a base foi construída pelos
 *     vídeos mais vistos, portanto o rendimento de novos sobe nas páginas fundas;
 *   - a banda de seguidores do FILTRO é sobre o total do creator, todas as plataformas
 *     somadas (um creator com 205k no Facebook e 44k no TikTok conta 291k). A banda por
 *     plataforma é reverificada aqui com o account_performance;
 *   - o scroll token do v4 expira em 60 s: pagina-se de seguida, nunca em round-robin;
 *   - o `rising_star` da Tubular é apertadíssimo (55 creators no beauty activo a 04/09) —
 *     fica como opção, não como omissão.
 *
 * O QUE MUDA FACE À A: o prospect entra COM @ e plataforma (promovível de imediato, sem
 * resolve-handles), com foto e data real do último post; entra SEM post_url (não há vídeo
 * que o prove) e o `termo` é o território ou a keyword do perfil. O crescimento é o dos
 * últimos meses fechados do monthly_trends, como na A; quando a série falta, cai para o
 * followers_growth a 30 dias do account_performance em vez de descartar.
 *
 *   GET ?territorio=beauty|health|lifestyle|todos   (omisso: beauty)
 *       &plataforma=ambas|tiktok|instagram           (omisso: ambas)
 *       &ativos=30          último post há menos de N dias (0 = sem limite)
 *       &fmin=3000&fmax=500000   banda de seguidores (omisso: a do território)
 *       &ordem=crescimento|views|recente   sort subscribers_30d_growth | monthly_views | last_upload
 *       &rising=1           só os que a Tubular marca como rising star
 *       &keyword=cabelo     texto no nome/descrição do PERFIL (não no conteúdo dos vídeos)
 *       &max=200            tecto de novos gravados; acima de 1000 corre em cadeia (elos de 1000)
 *       &elo=2              nº do elo — interno, posto pelo painel
 *       &dry=1              conta o universo (5 unidades por consulta) e estima o custo
 *
 * CADEIA POR PARTIÇÕES, NÃO POR TOKENS. A A guarda scroll tokens entre elos; aqui não
 * pode — expiram em 60 s. A retoma faz-se por PARTIÇÕES da banda de seguidores (3k–5k,
 * 5k–10k, … 200k–500k), cada uma listada até ao fim dentro do elo em que começa. O estado
 * guarda as partições feitas e os ids novos que sobraram do tecto (`pendentes`), que o elo
 * seguinte consome antes de listar mais. Uma partição é atómica — ou está feita ou é
 * relistada inteira — porque a graduação descarta (fora da banda por plataforma, inactivo,
 * já na base pelo @) sem gravar nada, e uma partição a meio voltaria a pagar esses
 * descartados no elo seguinte.
 *
 * Territórios com `exige_keyword` (health, lifestyle) não se partem por banda: correm uma
 * consulta por keyword, com a keyword no texto do perfil — o universo de cada uma é pequeno
 * e cabe num elo. Sem keyword, o género 7 (People & Blogs) é o saco de tudo, na A e aqui.
 *
 * O elo é conduzido pelo browser (DiscoveryPerfilRunner), pela mesma razão da A: a Vercel
 * corta auto-invocações à 5ª.
 */

const LOCK_KEY = "discover_perfil_lock";
const LOCK_MS = 6 * 60 * 1000;
const CADEIA_KEY = "discover_perfil_cadeia";
const ELO_MAX = 1000;
const ELOS_MAX = 12;
const ALVO_MAX = 10000;
const PAGINA = 200;        // tecto do v4
const LOTE_DETALHE = 100;  // ids por chamada de detalhe
const LOTE_TRENDS = 50;    // lote de 100 pode devolver 50 — assume-se o tecto (ver a A)
const PENDENTES_MAX = 5000;
const NTERMOS = 6;

// custos medidos a 04/09/2026 (unidades por linha devolvida)
const CUSTO_LISTA = 5;
const CUSTO_DETALHE = 20; // snippet 5 + account_snippet 5 + account_performance 10
const CUSTO_TRENDS = 0.1;
// fracção de linhas listadas que são novas para a base — 17,5% medido no topo por views a
// 04/09; conservador para o topo, optimista para o fundo, onde a sobreposição cai
const RENDIMENTO_NOVOS = 0.2;

// cortes das partições de seguidores — a banda do território (3k–500k) parte-se aqui
const CORTES = [3000, 5000, 10000, 20000, 35000, 60000, 100000, 200000, 500000];

const ORDENS = {
  crescimento: { metric: "subscribers_30d_growth", ascending: false },
  views: { metric: "monthly_views", ascending: false },
  recente: { metric: "last_upload", ascending: false },
};

const JUNK = new Set(["p", "reel", "reels", "stories", "explore", "video", "tag", "channel"]);

/** @ a partir da URL da conta que o account_snippet devolve. Minúsculas, como o resolve-handles grava. */
function handleDe(plat, url) {
  if (!url) return null;
  const s = String(url);
  const m = plat === "instagram"
    ? s.match(/instagram\.com\/@?([A-Za-z0-9._]+)/)
    : s.match(/tiktok\.com\/@([A-Za-z0-9._]+)/);
  const h = m?.[1]?.replace(/\.+$/, "").toLowerCase() ?? null;
  if (!h || JUNK.has(h)) return null;
  return h;
}

const canonico = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, o[k] ?? null]));

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

// lock por compare-and-set no sweep_state — o mesmo desenho da A, chave própria
async function tentarLock(db) {
  const agora = new Date();
  const ate = new Date(agora.getTime() + LOCK_MS).toISOString();
  await db.from("sweep_state").insert({ key: LOCK_KEY, value: { ate: new Date(0).toISOString() } }).then(() => {}, () => {});
  const { data } = await db.from("sweep_state")
    .update({ value: { ate, dono: agora.toISOString() }, updated_at: agora.toISOString() })
    .eq("key", LOCK_KEY).lt("value->>ate", agora.toISOString())
    .select("key");
  return !!data?.length;
}
const largarLock = (db) =>
  db.from("sweep_state").update({ value: { ate: new Date(0).toISOString() } }).eq("key", LOCK_KEY).then(() => {}, () => {});

async function run(req) {
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 200 });

  const sp = new URL(req.url).searchParams;
  const chave = sp.get("territorio") || "beauty";
  const chaves = chave === "todos" ? [...CHAVES] : [chave];
  const invalida = chaves.find((k) => !territorio(k));
  if (invalida) return NextResponse.json({ error: `território inválido: ${invalida}. Válidos: ${CHAVES.join(", ")}, todos` }, { status: 200 });

  const plataforma = sp.get("plataforma") || "ambas";
  const plats = plataforma === "tiktok" ? ["tiktok"] : plataforma === "instagram" ? ["instagram"] : ["instagram", "tiktok"];
  const ativos = Math.max(0, Math.min(Number(sp.get("ativos") ?? 30), 1825));
  // banda: a do território por omissão; o operador pode apertá-la (uma sub-banda) ou alargá-la
  const faixaBase = territorio(chaves[0]).faixa;
  const fmin = Math.max(0, Number(sp.get("fmin")) || faixaBase.min);
  const fmax = Math.max(fmin + 1, Number(sp.get("fmax")) || faixaBase.max);
  const ordem = ORDENS[sp.get("ordem")] ? sp.get("ordem") : "crescimento";
  const rising = sp.get("rising") === "1";
  const keyword = (sp.get("keyword") || "").trim().slice(0, 80) || null;
  const dry = !!sp.get("dry");
  const db = supabaseAdmin();

  const alvo = Math.min(Number(sp.get("max")) || 200, ALVO_MAX);
  const emCadeia = alvo > ELO_MAX;
  const eloPedido = Math.max(1, Number(sp.get("elo")) || 1);

  const hoje = new Date().toISOString().slice(0, 10);
  const desdeISO = ativos > 0 ? new Date(Date.now() - ativos * 864e5).toISOString().slice(0, 10) : null;

  // ─── consultas: território × (partição de banda | keyword) ────────────────
  //
  // Ordem partição-major entre territórios: com `todos`, listar o beauty inteiro antes do
  // health deixaria o beauty encher o tecto sozinho (o mesmo bug que a A teve com as
  // plataformas a 29/07). Intercalar as partições reparte o tecto pelos territórios.
  const cortes = [fmin, ...CORTES.filter((c) => c > fmin && c < fmax), fmax];
  // as partições dentro dos 10k–300k vão primeiro: é a banda a que o funnelMiniScore dá os
  // 30 pontos de tamanho (lib/score.js), e uma corrida pequena (tecto 200) só toca nas
  // primeiras. Por ordem crescente, começava sempre pelos 3k–5k — onde a banda por
  // plataforma mais descarta e o score menos premeia. Ordenação estável: dentro de cada
  // grupo mantém-se a ordem crescente.
  const bandas = cortes.slice(0, -1).map((min, i) => ({ min, max: cortes[i + 1] }))
    .sort((a, b) => (a.min >= 10000 && a.max <= 300000 ? 0 : 1) - (b.min >= 10000 && b.max <= 300000 ? 0 : 1));
  const porTerritorio = chaves.map((k) => {
    const t = territorio(k);
    if (keyword) return [{ chave: k, termo: keyword, banda: { min: fmin, max: fmax } }];
    if (t.exige_keyword) return t.keywords.slice(0, NTERMOS).map((termo) => ({ chave: k, termo, banda: { min: fmin, max: fmax } }));
    return bandas.map((banda) => ({ chave: k, termo: null, banda }));
  });
  const consultas = [];
  for (let i = 0; porTerritorio.some((l) => i < l.length); i++) {
    for (const l of porTerritorio) if (i < l.length) consultas.push(l[i]);
  }
  for (const c of consultas) c.key = `${c.chave}|${c.termo ?? ""}|${c.banda.min}-${c.banda.max}`;

  const incluir = (c) => ({
    countries: ["BR"],
    genres: territorio(c.chave).generos,
    types: ["influencer"],
    platforms: plats,
    ...(rising ? { rising_star: true } : {}),
    ...(c.termo ? { search: c.termo } : {}),
    performance: {
      followers: { min: c.banda.min, max: c.banda.max },
      ...(desdeISO ? { last_upload: { min: desdeISO } } : {}),
    },
  });

  // ─── cadeia: estado herdado e retoma ───────────────────────────────────────
  const paramsCadeia = { chave, plataforma, ativos, fmin, fmax, ordem, rising, keyword };
  let cadeia = null;
  let elo = eloPedido;
  if (emCadeia && !dry) {
    const { data } = await db.from("sweep_state").select("value, updated_at").eq("key", CADEIA_KEY).maybeSingle();
    const st = data?.value ?? null;
    const fresca = st && !st.done && data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < 60 * 60000;
    if (eloPedido > 1) {
      if (!fresca) return NextResponse.json({ error: `cadeia não encontrada ou expirada no elo ${eloPedido} — recomeçar do painel` }, { status: 200 });
      cadeia = st;
    } else if (fresca && st.params && canonico(st.params) === canonico(paramsCadeia)) {
      cadeia = st;
      elo = Number(st.elo) + 1;
    }
  }
  const gravadosAntes = cadeia?.gravados ?? 0;
  const maxElo = Math.min(ELO_MAX, alvo - gravadosAntes);
  if (emCadeia && !dry && maxElo <= 0) {
    return NextResponse.json({ ok: true, cadeia: { alvo, elo, gravados_acumulados: gravadosAntes, continua: false, motivo: "alvo atingido" } });
  }
  const max = dry ? alvo : (emCadeia ? maxElo : alvo);

  // ─── orçamento ─────────────────────────────────────────────────────────────
  // lista-se até encontrar `max` novos ao rendimento medido; cada novo paga detalhe + série
  const linhasEstimadas = Math.ceil(max / RENDIMENTO_NOVOS);
  const custoEstimado = linhasEstimadas * CUSTO_LISTA + max * (CUSTO_DETALHE + CUSTO_TRENDS);
  const orc = await podeGastar(custoEstimado, { nome: "descoberta por perfil" });

  if (dry) {
    // SONDA: o universo real de cada consulta, com `scroll.size: 1` (5 unidades cada). Com
    // `todos`, as consultas de health partilham o género 23 com o beauty, portanto a soma
    // tem sobreposição — é tecto, não promessa, e apresenta-se como tal.
    let sonda = null;
    if (!orc.ok) sonda = { erro: `sonda bloqueada: ${orc.motivo}` };
    else {
      // uma sonda por (território, termo) com a banda inteira — as partições são a mesma
      // pergunta partida, não vale a pena pagar uma por cada
      const unicas = [];
      const vistas = new Set();
      for (const c of consultas) {
        const k = `${c.chave}|${c.termo ?? ""}`;
        if (vistas.has(k)) continue;
        vistas.add(k);
        unicas.push({ ...c, banda: { min: fmin, max: fmax } });
      }
      sonda = { consultas: [], universo_somado: 0, custo_da_sonda_unidades: unicas.length * CUSTO_LISTA };
      let saldoSonda = null;
      for (const c of unicas) {
        try {
          const r = await tubularFetch("/v4/creator.search", { include: incluir(c), scroll: { size: 1 } }, { origem: `sonda-perfil:${c.chave}${c.termo ? ":" + c.termo : ""}` });
          saldoSonda = r.quota?.saldo ?? saldoSonda;
          const total = r.json?.total ?? null;
          sonda.consultas.push({ territorio: c.chave, termo: c.termo ?? "(género é o território)", creators: total });
          if (total != null) sonda.universo_somado += total;
        } catch (e) {
          sonda.consultas.push({ territorio: c.chave, termo: c.termo ?? "(género é o território)", erro: String(e).slice(0, 140) });
        }
      }
      // com o universo conhecido, a estimativa deixa de assumir que há sempre mais páginas
      const linhas = Math.min(sonda.universo_somado, linhasEstimadas);
      const novosEsperados = Math.min(max, Math.round(sonda.universo_somado * RENDIMENTO_NOVOS));
      sonda.linhas_que_a_corrida_lista = linhas;
      sonda.novos_esperados = novosEsperados;
      sonda.custo_estimado_com_universo = Math.round(linhas * CUSTO_LISTA + novosEsperados * (CUSTO_DETALHE + CUSTO_TRENDS));
      if (saldoSonda != null) sonda.saldo_apos_sonda = Math.round(saldoSonda);
    }
    return NextResponse.json({
      dry: true, versao: "2026-09-04a", territorio: chave, territorios: chaves, plataformas: plats,
      criterio: { ativos, fmin, fmax, ordem, rising, keyword },
      consultas: consultas.length, particoes: bandas.length,
      custo_estimado_unidades: Math.round(custoEstimado),
      saldo_tubular: orc.saldo, piso: PISO, expira: orc.expira,
      leitura_do_saldo_ha_min: orc.idade_min ?? null,
      bloqueado_por: orc.ok ? null : orc.motivo,
      sonda,
    });
  }
  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_tubular: orc.saldo }, { status: 200 });

  let temLock = await tentarLock(db);
  if (!temLock && emCadeia && elo > 1) {
    for (let i = 0; i < 3 && !temLock; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      temLock = await tentarLock(db);
    }
  }
  if (!temLock) {
    const { data: cd } = await db.from("sweep_state").select("value, updated_at").eq("key", CADEIA_KEY).maybeSingle();
    const viva = cd?.value && !cd.value.done && Date.now() - new Date(cd.updated_at).getTime() < 10 * 60000;
    if (viva) {
      return NextResponse.json({
        error: `a tua descoberta por perfil está a correr — elo ${Number(cd.value.elo) + 1} em curso, ${cd.value.gravados} de ${cd.value.alvo} acumulados.`,
        cadeia: { alvo: cd.value.alvo, gravados_acumulados: cd.value.gravados, elo_em_curso: Number(cd.value.elo) + 1, continua: true },
      }, { status: 200 });
    }
    return NextResponse.json({ error: "já há uma descoberta por perfil a correr (lock activo). Tenta daqui a uns minutos." }, { status: 200 });
  }

  const t0 = Date.now();
  const restante = () => 240000 - (Date.now() - t0);
  try {
    // ─── a base, para o dedup por id E por @ ───────────────────────────────
    // A A só deduplica por tubular_id porque não tem o @. Aqui há @ e plataforma logo no
    // detalhe, portanto quem já está em prospects ou em creators por outra fonte (Apify,
    // IC, caption) também é apanhado — com outro tubular_id não bastaria o id.
    const [pros, cres] = await Promise.all([
      fetchAllRows(() => db.from("prospects").select("tubular_id, handle, platform").order("tubular_id")),
      fetchAllRows(() => db.from("creators").select("tubular_id, handle, platform").order("id")),
    ]);
    const idsBase = new Set();
    const handlesBase = new Set();
    for (const r of [...pros, ...cres]) {
      if (r.tubular_id) idsBase.add(r.tubular_id);
      if (r.handle) handlesBase.add(`${r.platform ?? "?"}|${String(r.handle).toLowerCase()}`);
    }

    let chamadas = 0, saldo = orc.saldo, lastErr = null, tempoEsgotado = false;
    const sort = ORDENS[ordem];

    // ─── PASSO 1: listar ids, partição a partição ───────────────────────────
    const feitas = new Set(cadeia?.particoes_feitas ?? []);
    // pendentes: [{ id, chave, termo }] — a consulta que os trouxe é o território a gravar
    let pendentes = (cadeia?.pendentes ?? []).filter((p) => p?.id && !idsBase.has(p.id));
    const vistos = new Set();
    const novos = []; // ids escolhidos para este elo
    const origemDe = new Map(); // id → { chave, termo } da consulta que o encontrou primeiro
    let listados = 0, jaNaBase = 0;

    // os que sobraram do elo anterior entram primeiro — já foram pagos na listagem
    while (pendentes.length && novos.length < max) {
      const p = pendentes.shift();
      if (!vistos.has(p.id)) { vistos.add(p.id); novos.push(p.id); origemDe.set(p.id, { chave: p.chave, termo: p.termo ?? null }); }
    }

    for (const c of consultas) {
      if (feitas.has(c.key)) continue;
      if (novos.length >= max) break;
      if (restante() < 70000) { tempoEsgotado = true; break; }
      let token = null, completa = false;
      for (let p = 0; p < 500; p++) {
        if (restante() < 40000) { tempoEsgotado = true; break; }
        let r;
        try {
          r = await tubularFetch("/v4/creator.search", {
            include: incluir(c), sort,
            scroll: token ? { size: PAGINA, token } : { size: PAGINA },
          }, { origem: `perfil:${c.key}` });
          chamadas++;
        } catch (e) { lastErr = String(e).slice(0, 200); break; }
        saldo = r.quota?.saldo ?? saldo;
        const ids = (r.json?.results ?? []).map((x) => x.id).filter(Boolean);
        listados += ids.length;
        for (const id of ids) {
          if (vistos.has(id)) continue;
          vistos.add(id);
          if (idsBase.has(id)) { jaNaBase++; continue; }
          // acima do tecto guarda-se para o elo seguinte em vez de perder — a partição é
          // atómica e não se volta a pagar
          origemDe.set(id, { chave: c.chave, termo: c.termo });
          if (novos.length < max) novos.push(id); else pendentes.push({ id, chave: c.chave, termo: c.termo });
        }
        token = r.json?.scroll?.token ?? null;
        if (!ids.length || !token || ids.length < PAGINA) { completa = true; break; }
      }
      if (completa) feitas.add(c.key);
      if (lastErr && !completa) break; // erro de transporte: não insistir noutras partições
    }
    const ineditosTotais = novos.length + pendentes.length;

    // ─── PASSO 2: detalhe — nome, foto, contas (@) e performance por plataforma ──
    const detalhes = new Map();
    for (let i = 0; i < novos.length; i += LOTE_DETALHE) {
      if (restante() < 30000) { tempoEsgotado = true; break; }
      const lote = novos.slice(i, i + LOTE_DETALHE);
      try {
        const r = await tubularFetch("/v4/creator.search", {
          include: { ids: lote },
          fields: { snippet: true, account_snippet: true, account_performance: true },
          scroll: { size: LOTE_DETALHE },
        }, { origem: "perfil:detalhe" });
        chamadas++;
        saldo = r.quota?.saldo ?? saldo;
        for (const x of r.json?.results ?? []) if (x?.id) detalhes.set(x.id, x);
      } catch (e) { lastErr = String(e).slice(0, 200); break; }
    }

    // ─── PASSO 3: série mensal (crescimento entre meses fechados, ER e views a 30 dias) ──
    const metricas = new Map();
    const comDetalhe = novos.filter((id) => detalhes.has(id));
    for (let i = 0; i < comDetalhe.length; i += LOTE_TRENDS) {
      if (restante() < 15000) { tempoEsgotado = true; break; }
      const lote = comDetalhe.slice(i, i + LOTE_TRENDS);
      try {
        const r = await tubularFetch("/v4/creator.monthly_trends", { include: { ids: lote } }, { origem: "perfil:grade" });
        chamadas++;
        saldo = r.quota?.saldo ?? saldo;
        for (const res of r.json?.results ?? []) {
          const cid = res.creator?.id; if (!cid) continue;
          metricas.set(cid, res.trends ?? []);
        }
      } catch (e) { lastErr = String(e).slice(0, 200); break; }
    }

    // ─── graduar e filtrar ─────────────────────────────────────────────────
    const linhas = [];
    const desc = { sem_detalhe: 0, sem_conta: 0, fora_da_faixa: 0, ja_na_base_por_handle: 0, inactivos: 0 };
    let comSerie = 0, porFallback = 0;
    const mesCorrente = hoje.slice(0, 7);

    for (const id of novos) {
      const d = detalhes.get(id);
      if (!d) { desc.sem_detalhe++; continue; }
      const contas = d.accounts ?? {};
      const cand = plats.map((p) => {
        const a = contas[p];
        const handle = a?.url ? handleDe(p, a.url) : null;
        if (!handle) return null;
        const perf = a.performance ?? {};
        return { plat: p, handle, conta: a, perf, followers: Number(perf.followers) || 0 };
      }).filter(Boolean);
      if (!cand.length) { desc.sem_conta++; continue; }

      // a banda do filtro era sobre o total do creator; aqui é por plataforma. Com `ambas`,
      // fica a conta maior dentro da banda
      const naBanda = cand.filter((c) => c.followers >= fmin && c.followers <= fmax).sort((a, b) => b.followers - a.followers);
      if (!naBanda.length) { desc.fora_da_faixa++; continue; }
      const esc = naBanda[0];
      if (handlesBase.has(`${esc.plat}|${esc.handle}`)) { desc.ja_na_base_por_handle++; continue; }

      const lastUpload = esc.perf.last_upload ? String(esc.perf.last_upload).slice(0, 10) : null;
      if (desdeISO && (!lastUpload || lastUpload < desdeISO)) { desc.inactivos++; continue; }

      const daPlat = (metricas.get(id) ?? []).filter((t) => t.platform === esc.plat)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      let growthPct = null, engPct = null, views30 = null;
      if (daPlat.length) {
        comSerie++;
        const ult = daPlat[daPlat.length - 1];
        // crescimento só entre meses FECHADOS — o mesmo raciocínio da A (o mês em curso é parcial)
        const fechados = daPlat.filter((t) => String(t.month) < mesCorrente);
        const ultF = fechados[fechados.length - 1];
        const penF = fechados[fechados.length - 2];
        const f1 = Number(ultF?.followers?.all_time) || 0;
        const f0 = Number(penF?.followers?.all_time) || 0;
        growthPct = f0 > 0 && f1 > 0 ? ((f1 - f0) / f0) * 100
          : (ultF?.followers?.month_over_month != null ? Number(ultF.followers.month_over_month) * 100 : null);
        engPct = ult?.aggregated?.engagement_rate != null ? Number(ult.aggregated.engagement_rate) : null;
        views30 = ult?.aggregated?.views_30_days != null ? Number(ult.aggregated.views_30_days) : null;
      } else {
        porFallback++;
      }
      // sem série: o account_performance traz o crescimento a 30 dias (fraccional) e os
      // totais de engagement e views — ER sempre eng ÷ views (lib/engagement.js)
      if (growthPct == null && esc.perf.followers_growth != null) growthPct = Number(esc.perf.followers_growth) * 100;
      if (engPct == null) engPct = engRateViews(esc.perf.engagements, esc.perf.views);

      const origem = origemDe.get(id) ?? { chave: chaves[0], termo: null };
      linhas.push({
        tubular_id: id,
        name: d.snippet?.title ?? esc.conta.title ?? null,
        thumbnail: d.snippet?.thumbnail ?? esc.conta.thumbnail ?? null,
        country: "BR",
        // o território é o da consulta que o encontrou — com `todos`, beauty e health
        // partilham o género 23 e o primeiro a listá-lo fica com ele
        genre: origem.chave,
        platform: esc.plat,
        handle: esc.handle,
        followers: esc.followers,
        followers_30: Number.isFinite(Number(esc.perf.followers_30)) ? Math.round(Number(esc.perf.followers_30)) : null,
        growth_30: growthPct != null ? Math.round(growthPct * 100) / 100 : null,
        eng_rate: engPct != null ? Math.round(engPct * 100) / 100 : null,
        views_total: views30 ?? null,
        uploads_30: Number.isFinite(Number(esc.perf.uploads_30)) ? Number(esc.perf.uploads_30) : null,
        uploads_90: Number.isFinite(Number(esc.perf.uploads_90)) ? Number(esc.perf.uploads_90) : null,
        last_upload: lastUpload ?? hoje,
        rising_star: rising ? true : null,
        mini_score: funnelMiniScore({ engPct: engPct ?? 0, followers: esc.followers, growthPct }),
        fonte: "tubular-perfil",
        termo: origem.termo ?? origem.chave, // a keyword do perfil que o trouxe, ou o território
        post_url: null,
        descoberto_em: hoje,
        status: "novo",
      });
    }

    let gravados = 0, erroGravacao = null;
    if (linhas.length) {
      const { error } = await db.from("prospects").upsert(linhas, { onConflict: "tubular_id", ignoreDuplicates: true });
      if (error) erroGravacao = error.message.slice(0, 200);
      else gravados = linhas.length;
    }

    // ─── cadeia: gravar o estado antes de largar o lock ────────────────────
    let cadeiaOut = null;
    if (emCadeia) {
      const gravadosAcum = gravadosAntes + gravados;
      const todasFeitas = consultas.every((c) => feitas.has(c.key));
      const haTrabalho = pendentes.length > 0 || !todasFeitas;
      // sem progresso = nada listado de novo E nada pendente, sem ser por falta de tempo
      const semProgresso = novos.length === 0 && !tempoEsgotado;
      const continua = gravadosAcum < alvo && elo < ELOS_MAX && haTrabalho && !semProgresso;
      await db.from("sweep_state").upsert({
        key: CADEIA_KEY,
        value: {
          params: paramsCadeia, particoes_feitas: [...feitas], pendentes: pendentes.slice(0, PENDENTES_MAX),
          gravados: gravadosAcum, alvo, elo, iniciado: cadeia?.iniciado ?? new Date().toISOString(), done: !continua,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      cadeiaOut = {
        alvo, elo, gravados_acumulados: gravadosAcum, continua,
        proximo_elo: continua ? elo + 1 : null,
        particoes_feitas: feitas.size, particoes: consultas.length, pendentes: pendentes.length,
        motivo: continua ? null
          : gravadosAcum >= alvo ? "alvo atingido"
          : !haTrabalho ? "universo esgotado — todas as partições listadas"
          : elo >= ELOS_MAX ? "tecto de elos"
          : "sem creators novos neste elo — parada por falta de progresso",
      };
    }

    return NextResponse.json({
      cadeia: cadeiaOut,
      ok: true,
      territorio: chave, territorios: chaves, plataformas: plats,
      criterio: { ativos, fmin, fmax, ordem, rising, keyword },
      consultas: consultas.length, particoes_feitas: feitas.size,
      listados,
      ja_na_base: jaNaBase,
      ineditos_totais: ineditosTotais,
      novos_apos_dedup: novos.length,
      detalhados: detalhes.size,
      graduados: comSerie,
      graduados_por_fallback: porFallback,
      gravados,
      por_plataforma: linhas.reduce((a, l) => ({ ...a, [l.platform]: (a[l.platform] ?? 0) + 1 }), {}),
      por_territorio: linhas.reduce((a, l) => ({ ...a, [l.genre]: (a[l.genre] ?? 0) + 1 }), {}),
      descartados: desc,
      pendentes_para_o_proximo_elo: emCadeia ? pendentes.length : 0,
      chamadas_tubular: chamadas,
      saldo_tubular: saldo != null ? Math.round(saldo) : null,
      custo_real_estimado: orc.saldo != null && saldo != null ? Math.round(orc.saldo - saldo) : null,
      segundos: Math.round((Date.now() - t0) / 1000),
      tempo_esgotado: tempoEsgotado || null,
      proximo_passo: gravados ? "entram com @ e plataforma — promovíveis de imediato, sem resolve-handles" : null,
      erroGravacao, lastErr,
    });
  } finally {
    await largarLock(db);
  }
}
