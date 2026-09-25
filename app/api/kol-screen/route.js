import { NextResponse } from "next/server";
import { resumoDisaster } from "@/lib/disaster";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BETS = /bet365|betano|pixbet|sportingbet|sporting\s?bet|\bblaze\b|tigrinho|esporte\s?da\s?sorte|7\s?games|estrela\s?bet|\bstake\b|cassino|\bcasino\b|casas?\s+de\s+apostas?|apostas?\s+(?:esportivas?|online|de\s+futebol)|jogo\s+do\s+tigre|\bbet\b/i;
const BEAUTY = /cabelo|hair|make|maquiagem|beleza|beauty|skincare|pele|unha|nail|perfume|fragr|noiva|ruiv|cacho|crespo|pentead|colora|est[ée]tica/i;

// ─────────── helpers de benchmark dinâmico (médias do próprio radar) ───────────
const BUCKETS = [
  ["cabelo", /cabelo|hair|cacho|crespo|colora|loiro|ruiv|fios|capilar|pentead/i],
  ["make", /make|maquiagem|batom|sombra|glam|grwm/i],
  ["skincare", /skincare|pele|skin|derm|[áa]cido|retinol|niacinamida/i],
  ["perfume", /perfume|fragr|perfumaria|olfat/i],
  ["unha", /unha|nail/i],
];
function bucketOf(nichos) {
  if (!nichos?.length) return null;
  const top = nichos.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
  const name = String(top.nicho || "");
  for (const [k, rx] of BUCKETS) if (rx.test(name)) return k;
  return BEAUTY.test(name) ? "beauty" : "outro";
}
function tierOf(f) {
  f = Number(f) || 0;
  if (f >= 500000) return "500k+";
  if (f >= 100000) return "100-500k";
  if (f >= 50000) return "50-100k";
  return "<50k";
}
function median(arr) {
  const a = (arr || []).filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function pctl(arr, p) {
  const a = (arr || []).filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}
async function fetchAll(make) {
  let out = [], from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error || !data?.length) break;
    out = out.concat(data);
    if (data.length < page || from > 60000) break;
    from += page;
  }
  return out;
}

// cache em memória (instância quente) — não recomputa o benchmark a cada creator num sweep
let _bench = null, _benchAt = 0;
async function getBenchmarks(db) {
  if (_bench && Date.now() - _benchAt < 10 * 60 * 1000) return _bench;
  const [creators, snaps, vids] = await Promise.all([
    fetchAll(() => db.from("creators").select("id, followers, brand_history")),
    fetchAll(() => db.from("snapshots").select("creator_id, eng_rate, captured_at").not("eng_rate", "is", null).order("captured_at", { ascending: false })),
    fetchAll(() => db.from("videos").select("creator_id, views, comments, shares, saves").or("shares.not.is.null,saves.not.is.null")),
  ]);
  const bucketBy = {}, tierBy = {};
  for (const c of creators) { bucketBy[c.id] = bucketOf(c.brand_history?.nichos); tierBy[c.id] = tierOf(c.followers); }
  const erBy = {};
  for (const s of snaps) if (!(s.creator_id in erBy)) erBy[s.creator_id] = Number(s.eng_rate);
  const erGroups = {}, erTier = {}, erAll = [];
  for (const id in erBy) {
    const er = erBy[id]; if (er == null) continue;
    erAll.push(er);
    (erGroups[`${bucketBy[id] || "?"}|${tierBy[id] || "?"}`] ||= []).push(er);
    (erTier[tierBy[id] || "?"] ||= []).push(er);
  }
  const rateGroups = {};
  for (const v of vids) {
    if (!(v.views > 0)) continue;
    const b = bucketBy[v.creator_id] || "?";
    const g = (rateGroups[b] ||= { cmt: [], sav: [], shr: [], viral: [] });
    if (v.comments != null) g.cmt.push(v.comments / v.views);
    if (v.saves != null) g.sav.push(v.saves / v.views);
    if (v.shares != null) g.shr.push(v.shares / v.views);
    if (v.shares != null || v.saves != null) g.viral.push(((v.shares || 0) + (v.saves || 0)) / v.views);
  }
  const rateAll = { cmt: [], sav: [], shr: [], viral: [] };
  for (const b in rateGroups) for (const k of ["cmt", "sav", "shr", "viral"]) rateAll[k] = rateAll[k].concat(rateGroups[b][k]);
  _bench = { erGroups, erTier, erAll, rateGroups, rateAll, n: { creators: creators.length, er: erAll.length, vids: vids.length } };
  _benchAt = Date.now();
  return _bench;
}
function erBenchFor(b, bucket, t) {
  const g = b.erGroups[`${bucket}|${t}`];
  const pool = g && g.length >= 8 ? g : (b.erTier[t]?.length >= 8 ? b.erTier[t] : b.erAll);
  return { mediana: median(pool), p75: pctl(pool, 0.75) };
}
function rateBenchFor(b, bucket) {
  const g = b.rateGroups[bucket];
  const pick = (k) => (g && g[k]?.length >= 8 ? g[k] : b.rateAll[k]);
  return { cmt: median(pick("cmt")), sav: median(pick("sav")), shr: median(pick("shr")), viralP75: pctl(pick("viral"), 0.75) };
}

/**
 * GET ?handle=xxx — screening de KOL (tag binária) + Rising Star (tag binária).
 * KOL: 2 gates eliminatórios (100k seguidores E território beauty >50%) e depois
 * Índice KOL (6 fatores 25/25/20/15/10/5) com corte 83/100. Fatores sem dado não punem (renormaliza).
 * Benchmarks (engajamento, viralização, médias do nicho) calculados dinamicamente do radar atual.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "kol-screen", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  const handle = new URL(req.url).searchParams.get("handle");
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("*").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
  const [{ data: snaps }, { data: videos }] = await Promise.all([
    db.from("snapshots").select("eng_rate, followers, captured_at").eq("creator_id", c.id).not("eng_rate", "is", null).order("captured_at", { ascending: false }).limit(1),
    db.from("videos").select("title, views, likes, comments, shares, saves, transcript, url, posted_at").eq("creator_id", c.id),
  ]);

  const bh = c.brand_history || {};
  const er = Number(snaps?.[0]?.eng_rate) || null;
  const bench = await getBenchmarks(db);
  const bucket = bucketOf(bh.nichos);
  const t = tierOf(c.followers);
  const erB = erBenchFor(bench, bucket, t);
  const rB = rateBenchFor(bench, bucket);

  // território beauty
  const topNicho = bh.nichos?.length ? bh.nichos.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a)) : null;
  const beautyPct = bh.nichos?.length ? bh.nichos.filter((n) => BEAUTY.test(n.nicho)).reduce((a, n) => a + Number(n.pct), 0) : null;
  const beautyOk = (beautyPct ?? 0) > 50 || !!(topNicho && BEAUTY.test(topNicho.nicho) && Number(topNicho.pct) > 50);
  const territorioOk = !!(topNicho && beautyOk);

  // viralização e rates do creator (por view)
  const vv = (videos || []).filter((v) => v.views > 0);
  const avgViews = vv.length ? Math.round(vv.reduce((a, v) => a + (Number(v.views) || 0), 0) / vv.length) : 0;
  const vViral = vv.filter((v) => v.shares != null || v.saves != null);
  const viralRate = vViral.length ? vViral.reduce((a, v) => a + (v.shares || 0) + (v.saves || 0), 0) / vViral.reduce((a, v) => a + v.views, 0) : null;
  const meanRate = (sel) => { const xs = vv.map((v) => (v[sel] != null ? v[sel] / v.views : null)).filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const cmtRate = meanRate("comments"), savRate = meanRate("saves"), shrRate = meanRate("shares");

  // red flag bets / engajamento mínimo
  const textos = [...(videos || []).map((v) => v.title || ""), ...(bh.marcas || []).map((m) => `${m.marca} ${m.evidencia || ""}`)].join(" \n ");
  const betHit = textos.match(BETS);
  const bet = !!betHit;

  // saúde comercial / saturação
  const ratio = bh.brand_engagement?.ratio ?? null;
  const comerciais = (bh.marcas || []).filter((m) => m.tipo === "publi" || m.tipo === "afiliado");

  // momentum (do Radar Score)
  const { data: lastScore } = await db.from("scores").select("momentum").eq("creator_id", c.id).order("id", { ascending: false }).limit(1).maybeSingle();
  const mom = lastScore?.momentum != null ? Number(lastScore.momentum) : null;
  const momAlto = mom != null && mom >= 12;

  // ───── métricas do peer-group (view creator_metrics: nicho × faixa) ─────
  const { data: m } = await db.from("creator_metrics").select("niche_bucket, band, niche_density, reach_eff, eng_index, follower_pct, consistency, n_vid, n_peer").eq("id", c.id).maybeSingle();
  const { data: shine } = await db.from("creator_shine").select("pt_adj, ine").eq("id", c.id).maybeSingle();
  const niche_bucket = m?.niche_bucket ?? null;
  const beautyNiche = !!niche_bucket && niche_bucket !== "outros";
  const nd = m?.niche_density != null ? Number(m.niche_density) : (topNicho ? Number(topNicho.pct) : null);
  const engIdx = m?.eng_index != null ? Number(m.eng_index) : null;
  const reachEff = m?.reach_eff != null ? Number(m.reach_eff) : null;
  const fpct = m?.follower_pct != null ? Number(m.follower_pct) : null;           // 0..1 dentro do nicho×faixa
  const consist = m?.consistency != null ? Math.round(Number(m.consistency) * 100) : null; // %

  const has = (x) => x != null;
  const sc = (x, cap) => Math.min((Number(x) || 0) / cap, 1);
  const kol_score = Math.round((0.30 * sc(nd, 100) + 0.25 * sc(engIdx, 2) + 0.20 * sc(reachEff, 1.5) + 0.15 * sc(consist, 100) + 0.10 * (Number(fpct) || 0)) * 100);
  const rising_score = Math.round((0.35 * sc(reachEff, 2) + 0.25 * sc(reachEff, 1.5) + 0.20 * sc(engIdx, 2) + 0.10 * sc(consist, 100) + 0.10 * sc(nd, 100)) * 100); // Growth imaturo → provisório

  // ───── sinais de autoridade de mercado (como marca de fato escolhe KOL) ─────
  // KOL = território + PELO MENOS UM sinal de autoridade (tamanho, topo-do-nicho, marcas que ja contratam, ou engajamento forte),
  // com piso de engajamento pra nao promover conta morta. Consistency deixou de ser portao (era artefato em dado raso).
  const followersN   = Number(c.followers) || 0;
  const macro        = followersN >= 300000;                 // tamanho absoluto (macro/mega)
  const topSize      = has(fpct) && fpct >= 0.70;            // topo do nicho x faixa
  const brandTrack   = comerciais.length >= 2;               // marcas grandes ja contratam = validacao de mercado
  const engAuthority = has(engIdx) && engIdx >= 1.2;        // engajamento de autoridade
  const engFloorOk   = engIdx == null || engIdx >= 0.5;    // piso: nao promove conta morta
  const realReach    = avgViews >= 1500 || (Number(c.followers) || 0) >= 50000; // piso de ALCANCE: KOL precisa ser visto (corta UGC nano c/ PR)
  const kolAuthority = macro || topSize || brandTrack || engAuthority;
  const dead         = (er != null && er < 0.3) && (engIdx == null || engIdx < 0.6);

  // ───── 5 classes (v3 — KOL alinhado ao mercado: territorio + autoridade) ─────
  let classe;
  if (bet) classe = "nao_recomendada";
  else if (beautyNiche && nd != null && nd >= 40 && engFloorOk && realReach && kolAuthority) classe = "kol";
  else if (beautyNiche && nd != null && nd >= 50 && has(engIdx) && engIdx >= 1.5 && has(reachEff) && reachEff >= 1.0 && has(fpct) && fpct < 0.30) classe = "hidden_gem";
  else if (beautyNiche && nd != null && nd >= 40 && has(engIdx) && engIdx >= 1.3 && has(reachEff) && reachEff >= 0.6 && has(fpct) && fpct >= 0.30 && fpct < 0.75) classe = "rising_star";
  else if (beautyNiche && consist != null && consist >= 70 && has(engIdx) && engIdx >= 0.9 && engIdx <= 1.2) classe = "brand_performer";
  else if (!beautyNiche) classe = "generalista";
  else if (dead) classe = "nao_recomendada";
  else classe = "promissora";

  const CLASSES = {
    kol: "👑 KOL — autoridade do território",
    rising_star: "★ Rising Star — em aceleração",
    hidden_gem: "💎 Hidden Gem — pequena que entrega",
    brand_performer: "🛡 Brand Safe Performer — base confiável",
    promissora: "◇ Watchlist — em validação",
    generalista: "◯ Generalist — sem território dominante",
    nao_recomendada: "⚠ Not Recommended — red flag",
  };
  const is_kol = classe === "kol";
  const is_rising_star = classe === "rising_star";
  const status = is_kol ? "kol" : classe === "nao_recomendada" ? "reprovado" : "fora_do_perfil";

  // ───── defesa da categoria (critérios legíveis, RELATIVOS ao peer nicho×faixa) ─────
  const defesa = [
    { id: 1, nome: "Território — densidade no nicho", resultado: nd == null ? "sem dado" : nd >= 60 ? "especialista" : nd >= 40 ? "afinidade forte" : "difuso", detalhe: niche_bucket ? `${nd}% do conteúdo em ${niche_bucket}` : "rode o scan de nichos" },
    { id: 2, nome: "Engagement Index — vs pares do nicho×faixa", resultado: engIdx == null ? "sem dado" : engIdx >= 1.5 ? "muito forte" : engIdx >= 1.2 ? "acima da média" : engIdx >= 0.8 ? "na média" : "fraco", detalhe: engIdx == null ? "sem engajamento medido" : `${engIdx}× a mediana do nicho · (likes+comments)/views — shares/saves têm baixa cobertura` },
    { id: 3, nome: "Reach Efficiency — views ÷ seguidores", resultado: reachEff == null ? "sem dado" : reachEff >= 1.0 ? "viraliza" : reachEff >= 0.5 ? "forte" : reachEff >= 0.2 ? "normal" : "baixa", detalhe: reachEff == null ? "sem dado" : `${reachEff}× o tamanho da base por post` },
    { id: 4, nome: "Consistency — posts acima da mediana do nicho", resultado: consist == null ? "sem dado" : consist >= 70 ? "muito consistente" : consist >= 50 ? "consistente" : consist >= 30 ? "irregular" : "inconsistente", detalhe: consist == null ? "—" : `${consist}% dos posts batem a mediana do nicho` },
    { id: 5, nome: "Tamanho no nicho — percentil", resultado: fpct == null ? "sem dado" : fpct >= 0.75 ? "topo (P75+)" : fpct >= 0.30 ? "meio (P30–P75)" : "base (<P30)", detalhe: fpct == null ? "—" : `${Math.round(fpct * 100)}º percentil de seguidores em ${niche_bucket}·${m?.band || "?"}` },
  ];

  // ───── bloco comercial (vai pra área de marcas/cachê no perfil) ─────
  const comercial = [
    { id: "sat", nome: "Saturação de publicidade", resultado: comerciais.length >= 6 ? "red flag" : comerciais.length >= 3 ? "moderada" : "baixa", detalhe: `${comerciais.length} marcas com relação comercial no último ano${comerciais.length ? `: ${comerciais.slice(0,5).map((x)=>x.marca).join(", ")}` : ""}` },
    { id: "bets", nome: "Publi com BETs / apostas", resultado: bet ? "red flag" : "limpo", detalhe: bet ? `menção detectada: "${betHit[0]}" — revisar` : "nenhuma menção a casas de aposta" },
  ];

  const kol_screen = {
    classe, classe_label: CLASSES[classe], is_kol, is_rising_star, status,
    kol_score, rising_score, kol_index: kol_score,
    // n_peer entra aqui porque o corte de consistência do Score KOL precisa de saber
    // quantos pares formam a mediana antes de reprovar alguém com ela (lib/kolscore.js).
    metricas: { niche_bucket, band: m?.band ?? null, niche_density: nd, eng_index: engIdx, reach_eff: reachEff, follower_pct: fpct, consistency_pct: consist, n_peer: m?.n_peer ?? null, pt_adj: shine?.pt_adj ?? null, shine_ine: shine?.ine ?? null },
    eng_index_nota: "Engagement Index = (likes+comments)/views vs mediana do nicho×faixa; shares/saves têm baixa cobertura.",
    rising_provisorio: "Rising Star sem Growth Index (dado imaturo) — usa Reach + Engajamento + Percentil + Consistency; será reforçado com crescimento real.",
    criterios: defesa, defesa, comercial,
    // Disaster check gravado (feedback do cliente, set/2026, ponto 10): quem fica em risco
    // alto não entra na lista de um briefing — o /api/campaign lê daqui (lib/disaster.js).
    disaster: resumoDisaster({ bio: c.bio, videos: videos || [] }),
    benchmark: { fonte: `peer group nicho×faixa (view creator_metrics) · ${niche_bucket || "geral"}·${m?.band || "?"}` },
    avaliado_em: new Date().toISOString().slice(0, 10),
  };
  // Erro da gravação verificado de propósito: sem isto uma escrita recusada devolvia
  // sucesso e o /api/enrich contava o passo como "ok" com a base intacta.
  const { error: ue } = await db.from("creators").update({ kol_screen }).eq("id", c.id);
  if (ue) return NextResponse.json({ error: `kol_screen não gravado: ${ue.message}` }, { status: 200 });
  return NextResponse.json({ creator: c.handle, ...kol_screen });
}
