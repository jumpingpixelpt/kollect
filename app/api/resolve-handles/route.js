import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Resolve o @ dos prospects descobertos pela Tubular, a partir do URL de um post.
 *
 *   GET ?n=60 [&dry=1] [&genre=health]
 *
 * `genre` restringe a fila a um território (coluna `genre` dos prospects). Existe porque a
 * fila global ordena por mini_score e um casting por briefing (ex.: crescimento capilar,
 * ago/2026) precisa dos SEUS prospects resolvidos primeiro — sem o filtro, 782 dos 885
 * capilares descobertos a 01/08 caíam entre as posições 1000 e 8300 da fila.
 *
 * PORQUE EXISTE
 * A Tubular devolve creator_id, nome, métricas e género — mas nunca o @. O campo `accounts`
 * vem sempre null e os URLs vêm anonimizados (`tiktok.com/@redirect-to/video/ID`,
 * `instagram.com/p/CODE`), nenhum resolvendo por redirect HTTP. O efeito está medido: os
 * 3.484 prospects de fonte `tubular` têm 0% de handle, contra 100% em todas as outras fontes.
 *
 * O contorno até aqui era o promote-apify ADIVINHAR o @ pelo nome: procura o nome no
 * Instagram, pontua por tokens coincidentes e aceita acima de 0,5 de confiança. É de onde
 * vêm os status `apify:homonima_suspeita` e `apify:handle_nao_resolvido`.
 *
 * Um post, ao contrário de um nome, identifica o autor sem ambiguidade. Resolver por aí é
 * determinístico e elimina a classe inteira de erros por homonímia.
 *
 * CLAIM
 * Marca `status = 'resolvendo_handle'` antes de gastar Apify, no padrão do transcribe-casting,
 * e reverte em caso de falha. Sem isto, duas invecações sobrepostas do cron pagam o mesmo
 * perfil duas vezes.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

async function apify(actor, input, timeout = 120) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000),
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

async function run(req) {
  if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const n = Math.min(Number(sp.get("n")) || 60, 200);
  const dry = !!sp.get("dry");
  const genre = sp.get("genre") || null;
  // ?briefing= — mesmo racional do ?genre= aqui e do ?briefing= no collect, mas o género
  // não chega: os candidatos de um briefing espalham-se por vários (o capilar masculino a
  // 03/ago/2026 tinha health 107, lifestyle 51, Beauty 47, beauty 40 — e "Beauty"/"beauty"
  // são valores distintos). A drenagem de 01/08 correu só com genre=health, e por isso os
  // restantes 153 nunca foram tentados: aparecem no ecrã como "handle não resolvido" quando
  // na verdade é fila por correr. Resolver POR BRIEFING serve o pedido do cliente primeiro.
  const briefing = sp.get("briefing") || null;
  // ?tubular_id=a,b — alvo explícito. Existe porque o botão "Promover ao radar" precisa de
  // resolver UM prospect a pedido de um humano, e esse pedido tem de furar o filtro terminal
  // `sem_handle`: quem carrega no botão está justamente a dizer "tenta outra vez este".
  const alvo = (sp.get("tubular_id") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const db = supabaseAdmin();
  const t0 = Date.now();

  // Claims presos: se a função morrer entre o claim e a gravação, o prospect ficava em
  // 'resolvendo_handle' para sempre — fora da fila e invisível. A tabela não tem updated_at,
  // por isso o instante do claim vai no próprio status (é o padrão do repo: 'vids:12',
  // 'apify:perfil:@x'). O epoch em ms tem largura fixa, logo o `lt` textual compara bem.
  const CLAIM = "resolvendo_handle:";
  const corte = Date.now() - 15 * 60000; // nenhuma corrida legítima passa de 5 min (maxDuration 300s)
  await db.from("prospects").update({ status: "novo" })
    .like("status", `${CLAIM}%`).lt("status", `${CLAIM}${corte}`)
    .then(() => {}, () => {});

  // 'sem_handle' é TERMINAL e tem de ficar fora da fila: sem isto os mesmos falhados eram
  // repescados e repagos no Apify em todas as corridas, e como ordenam por mini_score alto
  // ficavam eternamente à cabeça, impedindo a fila de andar.
  //
  // É uma FAMÍLIA de estados, casada por prefixo — `sem_handle` (falhou uma vez) e
  // `sem_handle:irrecuperavel:<data>` (re-testado e dado como perdido, ver docs/handles-
  // irrecuperaveis.md). O `neq` exato deixava passar a variante com sufixo e voltava a pagá-la.
  let filaQ = db.from("prospects")
    .select("tubular_id, name, platform, post_url", { count: "exact" })
    .is("handle", null).not("post_url", "is", null);
  // o alvo explícito ignora o corte terminal e o claim; a fila automática mantém os dois
  if (alvo.length) filaQ = filaQ.in("tubular_id", alvo);
  else filaQ = filaQ.not("status", "like", "sem_handle%").not("status", "like", `${CLAIM}%`);
  if (genre) filaQ = filaQ.eq("genre", genre);
  if (briefing) {
    // Pela VIEW, não pela tabela de membros: ela já cruza com prospects e creators, o que
    // permite pedir só quem ainda não tem @ — algumas centenas — em vez dos ~10 mil membros
    // do briefing. Um `.in()` com 10 mil ids rebenta o comprimento do pedido e devolve zero.
    const ids = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("briefing_member_view")
        .select("prospect_id").eq("briefing_id", briefing).is("cid", null).is("p_handle", null)
        .not("prospect_id", "is", null)
        .order("p_mini", { ascending: false, nullsFirst: false })
        .range(from, from + 999);
      if (error || !data?.length) break;
      ids.push(...data.map((r) => r.prospect_id));
      if (data.length < 1000 || ids.length >= 3000) break;
    }
    if (!ids.length) return NextResponse.json({ ok: true, msg: "briefing sem candidatos por resolver", briefing });
    filaQ = filaQ.in("tubular_id", [...new Set(ids)]);
  }
  const { data: fila, count } = await filaQ
    .order("mini_score", { ascending: false, nullsFirst: false })
    .limit(n);

  if (dry) {
    return NextResponse.json({
      dry: true, genre, briefing, fila_total: count ?? 0, neste_lote: fila?.length ?? 0,
      por_plataforma: contarPor(fila, "platform"),
      custo_apify_estimado_usd: Math.round((fila?.length ?? 0) * 0.0019 * 1000) / 1000,
    });
  }
  if (!fila?.length) return NextResponse.json({ ok: true, msg: "nada por resolver", fila_total: count ?? 0 });

  // claim antes de gastar, com o instante embutido para a recuperação acima
  const ids = fila.map((p) => p.tubular_id);
  await db.from("prospects").update({ status: `${CLAIM}${Date.now()}` }).in("tubular_id", ids);

  // A plataforma vem do URL do post, não da coluna. `platform` é nulo em boa parte dos
  // prospects da Tubular (44 de 60 no lote do briefing capilar a 03/ago/2026) e o filtro
  // por coluna deixava-os fora dos DOIS ramos: eram reclamados, ninguém os resolvia, e a
  // gravação marcava-os `sem_handle` — terminal — sem uma única chamada ter sido feita por
  // eles. O URL do post diz a plataforma sem ambiguidade e é o que os actors consomem.
  const plataformaDe = (p) =>
    /instagram\.com\//.test(p.post_url || "") ? "instagram"
    : /tiktok\.com\//.test(p.post_url || "") ? "tiktok"
    : p.platform || null;
  const igs = fila.filter((p) => plataformaDe(p) === "instagram" && /instagram\.com\/(p|reel|reels)\//.test(p.post_url || ""));
  const tks = fila.filter((p) => plataformaDe(p) === "tiktok" && /tiktok\.com\//.test(p.post_url || ""));

  const resolvidos = new Map(); // tubular_id → handle
  const erros = [];
  let tentouIG = false, tentouTK = false;

  // Orçamento de tempo: o que decide não é quanto já passou, é se o actor AINDA CABE.
  // Um `elapsed < 200s` seguido de um actor com timeout de 180s dá 380s contra um
  // maxDuration de 300 — a função morria antes de gravar, e o claim ficava por reverter.
  const LIMITE = 240000;
  const cabe = (segundosDoActor) => (LIMITE - (Date.now() - t0)) > (segundosDoActor * 1000 + 15000);

  // ─── Instagram: directUrls → ownerUsername ────────────────────────────────
  const T_IG = 100;
  if (igs.length && cabe(T_IG)) {
    try {
      const items = await apify("apify~instagram-scraper", {
        directUrls: igs.map((p) => p.post_url),
        resultsType: "posts", resultsLimit: 1, addParentData: false,
      }, T_IG);
      // Só conta como "tentado" com o actor a responder: se ele rebentar inteiro (timeout,
      // rate limit), ninguém foi visto — marcar o lote como sem_handle terminal enterrava
      // ~115 prospects por uma falha que não era deles (aconteceu a 01/08: 180 IG num dia).
      tentouIG = true;
      const porUrl = new Map();
      for (const it of items) {
        const u = it.ownerUsername || it.owner?.username || it.username || null;
        const key = String(it.url || it.inputUrl || it.postUrl || "").split("?")[0];
        // nunca gravar segmentos de URL como username — o legado "handle=p" (61 prospects
        // a 02/ago/2026) veio de um extrator antigo; este é o portão que impede a reentrada
        if (u && key && !["p", "reel", "reels", "stories", "explore"].includes(u.toLowerCase())) porUrl.set(key, u);
      }
      for (const p of igs) {
        const k = String(p.post_url).split("?")[0];
        const h = porUrl.get(k) ?? acharPorCodigo(porUrl, k);
        if (h) resolvidos.set(p.tubular_id, h.toLowerCase());
      }
    } catch (e) { erros.push(`instagram: ${String(e).slice(0, 150)}`); }
  }

  // ─── TikTok: postURLs → authorMeta.name ──────────────────────────────────
  // O URL vem com o @ mascarado (`@redirect-to`), mas o ID do vídeo é real e é ele que
  // identifica o post. Se o actor não aceitar o URL mascarado, o lote falha inteiro e os
  // prospects voltam à fila pelo revert do claim — não ficam presos.
  const T_TK = 100;
  if (tks.length && cabe(T_TK)) {
    try {
      const items = await apify("clockworks~tiktok-scraper", {
        postURLs: tks.map((p) => p.post_url),
        shouldDownloadVideos: false, shouldDownloadCovers: false, resultsPerPage: 1,
      }, T_TK);
      tentouTK = true; // só com o actor a responder — ver o comentário do Instagram
      const porId = new Map();
      for (const it of items) {
        const h = it.authorMeta?.name || it.authorMeta?.uniqueId || null;
        const vid = String(it.id || it.webVideoUrl || "").match(/(\d{10,})/)?.[1];
        if (h && vid) porId.set(vid, h);
      }
      for (const p of tks) {
        const vid = String(p.post_url).match(/(\d{10,})/)?.[1];
        const h = vid ? porId.get(vid) : null;
        if (h) resolvidos.set(p.tubular_id, String(h).toLowerCase());
      }
    } catch (e) { erros.push(`tiktok: ${String(e).slice(0, 150)}`); }
  }

  // ─── gravar e reverter o claim de quem não resolveu ───────────────────────
  let gravados = 0;
  const platDe = new Map(fila.map((p) => [p.tubular_id, plataformaDe(p)]));
  for (const [tid, handle] of resolvidos) {
    // grava a plataforma junto com o @: o promote roteia por ela para escolher o actor, e
    // deixá-la nula mandava um prospect de TikTok pelo caminho do Instagram
    const patch = { handle, status: "novo" };
    const plat = platDe.get(tid);
    if (plat) patch.platform = plat;
    const { error } = await db.from("prospects").update(patch).eq("tubular_id", tid);
    if (!error) gravados++;
  }
  // Só é 'sem_handle' — terminal — quem foi MESMO tentado. Quem ficou de fora por falta de
  // orçamento de tempo volta a 'novo' para a próxima corrida: marcar como terminal algo que
  // nunca se tentou é perder o prospect por uma razão que não tem nada a ver com ele.
  const tentados = new Set([...(tentouIG ? igs : []), ...(tentouTK ? tks : [])].map((p) => p.tubular_id));
  const falhados = ids.filter((id) => !resolvidos.has(id) && tentados.has(id));
  const adiados = ids.filter((id) => !resolvidos.has(id) && !tentados.has(id));
  if (falhados.length) await db.from("prospects").update({ status: "sem_handle" }).in("tubular_id", falhados);
  if (adiados.length) await db.from("prospects").update({ status: "novo" }).in("tubular_id", adiados);
  const naoResolvidos = falhados;

  return NextResponse.json({
    ok: true, genre, processados: fila.length, resolvidos: gravados,
    nao_resolvidos: naoResolvidos.length,
    por_plataforma: { instagram: igs.length, tiktok: tks.length },
    fila_restante: Math.max(0, (count ?? 0) - fila.length),
    segundos: Math.round((Date.now() - t0) / 1000),
    erros: erros.length ? erros : undefined,
  });
}

const contarPor = (rows, campo) => (rows || []).reduce((a, r) => { const k = r[campo] ?? "?"; a[k] = (a[k] || 0) + 1; return a; }, {});

/** Fallback: casar pelo código do post quando o actor devolve o URL noutra forma. */
function acharPorCodigo(mapa, url) {
  const code = String(url).match(/\/(?:p|reel|reels)\/([\w-]+)/)?.[1];
  if (!code) return null;
  for (const [k, v] of mapa) if (k.includes(code)) return v;
  return null;
}
