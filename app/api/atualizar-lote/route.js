import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { internalJson } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { agendarRefrescoRadar } from "@/lib/radar-cache";
import { territorioDe } from "@/lib/territorio";
import { territorioPct } from "@/lib/kolscore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ATUALIZAÇÃO BARATA de um território — tudo o que se renova sem mandar vídeos ao Gemini.
 *
 * Pedida a 03/09/2026 ("avança com a forma barata mas só para cabelo"). As peças de cada
 * creator são importadas uma vez, na promoção, e envelhecem: a 03/09 só 44 de 2.099 tinham
 * uma peça dos últimos 30 dias, e o cron diário renova métricas a ~370 creators por semana.
 * A atualização completa (deep-scan de 3 vídeos por creator desde 10/09/2026; era de 6 a
 * ~US$ 0,50) custa ~US$ 0,30 por creator;
 * esta custa ~US$ 0,05 a 0,09, porque faz só o que não passa pelo Gemini:
 *
 *   1. /api/import-videos?snapshot=1 — raspa o perfil no Apify: peças novas entram, as que
 *      já estão recebem views/likes/comentários frescos, e o snapshot do dia renova
 *      seguidores e taxa de engajamento (é uma raspagem só para as duas coisas);
 *   2. /api/brand-scan — o Claude relê as legendas: marcas, % por território, sub-nichos;
 *   3. kol-screen, score, kol-score e creator-embeddings — cálculos e índice, sem custo.
 *
 * ESCOPO = território de conteúdo do radar (lib/territorio.js, a classificação que a
 * página /creators mostra) OU ≥ min_pct do conteúdo nesse território segundo o brand-scan
 * (35% por defeito — o corte do e-mail do cliente de 02/09; o do Score KOL ainda é 50).
 * "Feito" = brand_history.escaneado_em de hoje; quem falha fica registado em sweep_state e
 * não volta a ser tentado até um ?reset=1, para uma falha permanente não comer o lote.
 *
 *   GET ?territorio=cabelo [&n=12] [&min_pct=35] [&dry=1] [&reset=1]
 *   GET ?campanha=<id>[,<id>] — escopo = creators no casting desses briefings (papéis
 *   visíveis), qualquer território. Pedido do Rui (11/09/2026): encher a janela de 90 dias
 *   só para quem o cliente vê, ~US$ 20 em vez de ~US$ 250 na base toda.
 *
 * n creators por chamada, CONC em paralelo; não se arranca creator novo depois de
 * TETO_ARRANQUE_MS, para o último lote caber nos 300 s da função. Quem repete a chamada
 * até `restantes` chegar a zero é o browser (o mesmo desenho do promote-batch): a Vercel
 * corta auto-invocações, e um condutor no servidor morria em silêncio. Um lock em
 * sweep_state impede duas chamadas sobrepostas de raspar o mesmo creator duas vezes.
 */
const CONC = 5;
const TETO_ARRANQUE_MS = 170_000;
const LOCK_MS = 5 * 60_000;
const LOCK = "atualizar_lote_lock";
const chaveEstado = (t) => `atualizar_lote:${t}`;
// chaves do radar (lib/territorio.js) → chaves do territorioPct (lib/kolscore.js)
const PCT_KEY = { cabelo: "cabelo", skincare: "skincare", maquiagem: "maquiagem", unhas: "unhas", perfume: "perfumaria" };

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
export const POST = GET;

async function run(req) {
  const arranque = Date.now();
  const sp = new URL(req.url).searchParams;
  const campanhas = (sp.get("campanha") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const territorio = campanhas.length ? `campanha:${campanhas.join(",").slice(0, 80)}` : (sp.get("territorio") || "cabelo");
  if (!campanhas.length && !PCT_KEY[territorio]) return NextResponse.json({ error: `território desconhecido — opções: ${Object.keys(PCT_KEY).join(" | ")}` }, { status: 200 });
  const n = Math.min(Math.max(Number(sp.get("n")) || 12, 1), 40);
  const minPct = Number(sp.get("min_pct")) || 35;
  const dry = sp.get("dry") === "1";
  const base = new URL(req.url).origin;
  const db = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);
  const agora = () => new Date().toISOString();

  // ── estado da corrida ──
  const estadoKey = chaveEstado(territorio);
  const { data: est } = await db.from("sweep_state").select("value").eq("key", estadoKey).maybeSingle();
  const estado = est?.value && sp.get("reset") !== "1"
    ? { falhados: {}, feitos: 0, chamadas: 0, ...est.value }
    : { territorio, min_pct: minPct, iniciado: agora(), feitos: 0, chamadas: 0, falhados: {} };

  // ── escopo ──
  const rows = await fetchAllRows(() => db.from("creators")
    .select("id, handle, platform, followers, territorio, niche, category, brand_history, niche_bucket:kol_screen->metricas->>niche_bucket"));
  // escopo por briefing: os creators do casting (sem fora do território / não recomendada / funil)
  let noCasting = null;
  if (campanhas.length) {
    const { data: cc } = await db.from("campaign_creators").select("creator_id, campaign_role").in("campaign_id", campanhas).not("creator_id", "is", null);
    noCasting = new Set((cc ?? []).filter((r) => !["out_of_territory", "not_recommended", "funil"].includes(r.campaign_role || "")).map((r) => r.creator_id));
  }
  const escopo = [];
  for (const r of rows) {
    if (!r.handle) continue;
    if (noCasting && !noCasting.has(r.id)) continue;
    const bh = r.brand_history || {};
    const nichos = Array.isArray(bh.nichos) ? bh.nichos : [];
    const top = nichos.length ? nichos.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a)) : null;
    const terr = territorioDe({ guardado: r.territorio, bucket: r.niche_bucket, textos: [top?.nicho, r.niche, r.category], analisado: nichos.length > 0 });
    const pct = noCasting ? 0 : (territorioPct(nichos, PCT_KEY[territorio]) ?? 0);
    if (!noCasting && terr !== territorio && pct < minPct) continue;
    escopo.push({ handle: r.handle, platform: r.platform, followers: Number(r.followers) || 0, pct, feito: bh.escaneado_em === hoje });
  }
  // os maiores primeiro: é por eles que o cliente pergunta (piso de 200k no e-mail de 02/09)
  const pendentes = escopo.filter((c) => !c.feito && !estado.falhados[c.handle]).sort((a, b) => b.followers - a.followers);
  const conta = (arr) => ({ instagram: arr.filter((c) => c.platform === "instagram").length, tiktok: arr.filter((c) => c.platform === "tiktok").length });
  const resumo = {
    versao: "2026-09-11c", // muda a cada deploy desta rota: é como o browser sabe que a versão nova está no ar
    territorio, min_pct: minPct,
    escopo: escopo.length, por_plataforma: conta(escopo),
    feitos: escopo.filter((c) => c.feito).length,
    falhados: Object.keys(estado.falhados).length,
    pendentes: pendentes.length,
    acima_200k: pendentes.filter((c) => c.followers >= 200000).length,
  };
  if (dry || !pendentes.length) {
    return NextResponse.json({ ...resumo, dry, concluido: !pendentes.length, proximos: pendentes.slice(0, 8).map((c) => `@${c.handle} (${c.platform}, ${c.followers}, ${c.pct}%)`) });
  }

  // ── lock contra chamadas sobrepostas ──
  const { data: lk } = await db.from("sweep_state").select("value").eq("key", LOCK).maybeSingle();
  if (lk?.value?.ate && new Date(lk.value.ate).getTime() > Date.now()) {
    return NextResponse.json({ ocupado: true, ate: lk.value.ate, ...resumo });
  }
  const lock = (ate) => db.from("sweep_state").upsert({ key: LOCK, value: { ate, territorio }, updated_at: agora() }, { onConflict: "key" });
  await lock(new Date(Date.now() + LOCK_MS).toISOString());

  // ── a cadeia barata, por creator ──
  const alvos = pendentes.slice(0, n);
  const resultados = [];
  const um = async (c) => {
    const h = encodeURIComponent(c.handle);
    const log = {};
    const passo = async (nome, path, timeout) => {
      const j = await internalJson(`${base}${path}`, { timeout, nome });
      log[nome] = j.error || j.fatal ? `erro: ${String(j.error || j.fatal).slice(0, 90)}` : "ok";
      return j;
    };
    const pecas = await passo("pecas", `/api/import-videos?handle=${h}&snapshot=1`, 200000);
    if (pecas.error || pecas.fatal) { resultados.push({ handle: c.handle, ok: false, log }); return; }
    const marcas = await passo("marcas", `/api/brand-scan?handle=${h}`, 150000);
    if (marcas.error || marcas.fatal) { resultados.push({ handle: c.handle, ok: false, log, pecas: { novas: pecas.novas, atualizadas: pecas.atualizadas } }); return; }
    await passo("screening", `/api/kol-screen?handle=${h}`, 60000);
    await passo("radar", `/api/score?handle=${h}`, 60000);
    await passo("kol-score", `/api/kol-score?handle=${h}`, 60000);
    await passo("index", `/api/creator-embeddings?handle=${h}`, 90000);
    // volume de comentários com as peças novas (grátis; o conteúdo pago fica na cadeia do enrich)
    await passo("conversa", `/api/conversa?handle=${h}&so_volume=1`, 60000);
    resultados.push({
      handle: c.handle, ok: true, log,
      novas: pecas.novas, atualizadas: pecas.atualizadas, seguidores: pecas.snapshot?.followers ?? null,
      pct_antes: c.pct,
    });
  };
  let cortado = false;
  for (let i = 0; i < alvos.length; i += CONC) {
    if (Date.now() - arranque > TETO_ARRANQUE_MS) { cortado = true; break; }
    await Promise.all(alvos.slice(i, i + CONC).map(um));
  }

  // ── estado ──
  for (const r of resultados) {
    if (r.ok) estado.feitos++;
    else estado.falhados[r.handle] = { em: hoje, log: r.log };
  }
  estado.ultimo = agora();
  estado.chamadas = (estado.chamadas || 0) + 1;
  await db.from("sweep_state").upsert({ key: estadoKey, value: estado, updated_at: agora() }, { onConflict: "key" });
  await lock(new Date(0).toISOString());

  const okN = resultados.filter((r) => r.ok).length;
  // lote do território concluído → a base do Creators Hub (radar_cache) remonta-se já, por trás
  // da resposta, em vez de esperar pelo cron de 5 min
  if (pendentes.length - resultados.length <= 0 && okN > 0) agendarRefrescoRadar();
  return NextResponse.json({
    ...resumo,
    nesta_chamada: { alvo: alvos.length, tentados: resultados.length, ok: okN, falhados: resultados.length - okN, cortado, segundos: Math.round((Date.now() - arranque) / 1000) },
    restantes: pendentes.length - resultados.length,
    resultados,
  });
}
