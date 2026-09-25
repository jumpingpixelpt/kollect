import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { funnelMiniScore } from "@/lib/score";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE_KEY = "ic_sweep_v1";
const STATE_KEY_MASC = "ic_sweep_masc_v1";
const BASE = "https://api-dashboard.influencers.club";
const PAGE_SIZE = 50;
const CREDIT_FLOOR = 10500; // pára se credits_left cair abaixo disso (proteção do pote de 12k)

// Descoberta pelo influencers.club DESLIGADA por omissão (decisão do cliente, jul/2026 —
// post-mortem dos créditos). Esta rota revelou a maior parte dos 37.815 prospects vindos do
// IC, 91% da base de prospects, e foi a maior linha de custo do plano anual de 12.000
// créditos. A descoberta passou para o Apify (promote-apify / promote-tiktok), que não gasta
// créditos do IC. O piso antigo (CREDIT_FLOOR) não chega como travão: é lido do `credits_left`
// da RESPOSTA, portanto cada invocação ainda queimava uma página de 50 perfis antes de parar.
// Para reabrir conscientemente: IC_DISCOVERY_ENABLED=1 no ambiente.
const DESCOBERTA_LIGADA = process.env.IC_DISCOVERY_ENABLED === "1";
const DESLIGADA_MSG = "descoberta via influencers.club desligada (decisão de jul/2026: o IC fica reservado à demografia de audiência). Use o Apify — /api/sweep, promote-apify, promote-tiktok. Para reabrir: IC_DISCOVERY_ENABLED=1.";

// fila de consultas: ai_search semântico + termos em bio + termos em legenda, IG e TikTok
const TERMOS_AI = ["maquiagem", "skincare", "cabelo", "beleza", "perfume", "unhas", "cílios e sobrancelhas", "autocuidado", "estética", "cabelo cacheado"];
const TERMOS_BIO = ["maquiadora", "cabeleireira", "skincare", "dermatologista", "tricologista", "nail designer", "lash designer", "esteticista", "beleza", "make"];
const TERMOS_CAP = ["rotina de skincare", "resenha de maquiagem", "dicas de beleza", "cabelo saudável", "pele oleosa", "anti-idade"];

// descoberta dirigida masculina (Onda 2 do plano): queda/crescimento capilar, barba,
// grooming e derma masc, mais a franja lifestyle/saúde que o briefing pede no output
const TERMOS_AI_MASC = ["queda de cabelo masculino", "calvície", "minoxidil", "crescimento capilar", "barba", "grooming masculino", "skincare masculino", "dermatologia", "saúde e bem-estar masculino", "lifestyle masculino"];
const TERMOS_BIO_MASC = ["barbeiro", "barbearia", "tricologista", "dermatologista", "grooming", "saúde capilar", "transplante capilar", "bem-estar"];
const TERMOS_CAP_MASC = ["queda de cabelo", "crescimento capilar", "rotina de barba", "minoxidil", "couro cabeludo", "skincare masculino"];

function buildQueue(masc) {
  const q = [];
  const [ai, bio, cap] = masc ? [TERMOS_AI_MASC, TERMOS_BIO_MASC, TERMOS_CAP_MASC] : [TERMOS_AI, TERMOS_BIO, TERMOS_CAP];
  for (const p of ["instagram", "tiktok"]) {
    for (const t of ai) q.push({ p, tipo: "ai", t });
    for (const t of bio) q.push({ p, tipo: "bio", t });
    for (const t of cap) q.push({ p, tipo: "cap", t });
  }
  return q;
}

async function discover(query, page) {
  const filters = { location: ["Brazil"], number_of_followers: { min: 3000, max: 500000 } };
  if (query.tipo === "ai") filters.ai_search = query.t;
  if (query.tipo === "bio") filters.keywords_in_bio = [query.t];
  if (query.tipo === "cap") filters.keywords_in_captions = [query.t];
  const r = await fetch(`${BASE}/public/v1/discovery/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ platform: query.p, paging: { limit: PAGE_SIZE, page }, sort: { sort_by: "relevancy", sort_order: "desc" }, filters }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`discovery ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

/**
 * GET /api/ic-sweep — varredura do universo beauty BR via influencers.club.
 * Fila de consultas (ai/bio/legenda × IG/TikTok), paginação por página,
 * upsert em prospects com handle + plataforma. Estado em sweep_state.
 * ?masc=1 corre a fila masculina/saúde (Onda 2) com estado próprio — as duas
 * varreduras são independentes. ?reset=1 recomeça · ?floor=N muda o piso de créditos.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

async function run(req) {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
  if (!DESCOBERTA_LIGADA) return NextResponse.json({ error: DESLIGADA_MSG, rota: "ic-sweep" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const floor = Number(sp.get("floor")) || CREDIT_FLOOR;
  const masc = sp.get("masc") === "1";
  const stateKey = masc ? STATE_KEY_MASC : STATE_KEY;
  const db = supabaseAdmin();
  const t0 = Date.now();

  if (sp.get("reset")) await db.from("sweep_state").delete().eq("key", stateKey);
  const { data: st } = await db.from("sweep_state").select("value").eq("key", stateKey).maybeSingle();
  const state = st?.value ?? { queue: buildQueue(masc), qi: 0, page: 0, inserted: 0, done: false };
  if (state.done) return NextResponse.json({ done: true, inserted: state.inserted, msg: "varredura concluída — ?reset=1 pra refazer" });

  let insertedNow = 0, pagesNow = 0, creditsLeft = null, lastErr = null, stopReason = null;

  while (Date.now() - t0 < 240000) {
    if (state.qi >= state.queue.length) { state.done = true; stopReason = "fila concluída"; break; }
    const query = state.queue[state.qi];
    let body;
    try { body = await discover(query, state.page); pagesNow++; }
    catch (e) { lastErr = `${query.tipo}:${query.t}/${query.p} p${state.page} — ${String(e).slice(0, 120)}`; state.qi++; state.page = 0; continue; }

    creditsLeft = Number(body.credits_left ?? NaN);
    if (!Number.isNaN(creditsLeft) && creditsLeft < floor) { stopReason = `piso de créditos atingido (${creditsLeft} < ${floor})`; break; }

    const accounts = body.accounts ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const ids = accounts.map((a) => `ic_${query.p === "tiktok" ? "tt" : "ig"}_${a.user_id}`);
    const { data: prevRows } = ids.length
      ? await db.from("prospects").select("tubular_id, followers_prev, followers_at, growth_30").in("tubular_id", ids)
      : { data: [] };
    const prevBy = Object.fromEntries((prevRows || []).map((p) => [p.tubular_id, p]));
    const rows = accounts.map((a) => {
      const tid = `ic_${query.p === "tiktok" ? "tt" : "ig"}_${a.user_id}`;
      const followers = a.profile?.followers ?? null;
      const engPct = a.profile?.engagement_percent != null ? Math.round(a.profile.engagement_percent * 100) / 100 : null;
      const pv = prevBy[tid];
      const row = {
        tubular_id: tid,
        name: a.profile?.full_name || a.profile?.username || null,
        handle: a.profile?.username ?? null,
        platform: query.p,
        thumbnail: a.profile?.picture ?? null,
        country: "BR",
        genre: masc ? "Masc/Saúde (IC)" : "Beauty (IC)",
        followers,
        eng_rate: engPct,
        termo: `${query.tipo}:${query.t}`,
        fonte: "influencers_club",
      };
      // crescimento AUTO-MEDIDO: delta de seguidores vs baseline (que rola ~semanalmente p/ reduzir ruído)
      let growthPct = pv?.growth_30 ?? null;
      const base = pv?.followers_prev, baseAt = pv?.followers_at;
      if (base > 0 && baseAt && followers) {
        const days = Math.max(0, Math.round((new Date(today) - new Date(baseAt)) / 864e5));
        if (days >= 1) {
          const g = ((followers - base) / base) * 100 * (30 / days);
          growthPct = Math.round(Math.max(-90, Math.min(300, g)) * 10) / 10;
          row.growth_30 = growthPct;
          if (days >= 7) { row.followers_prev = followers; row.followers_at = today; } // rola baseline
        }
      } else {
        row.followers_prev = followers; // novo prospect: inicia baseline
        row.followers_at = today;
      }
      row.mini_score = funnelMiniScore({ engPct, followers, growthPct });
      return row;
    }).filter((r) => r.handle && r.followers);

    if (rows.length) {
      const { error } = await db.from("prospects").upsert(rows, { onConflict: "tubular_id", ignoreDuplicates: false });
      if (error) lastErr = String(error.message).slice(0, 150);
      else { state.inserted += rows.length; insertedNow += rows.length; }
    }

    // próxima página ou próximo termo (teto 10k resultados/consulta = 200 páginas de 50)
    const total = body.total ?? 0;
    if (accounts.length < PAGE_SIZE || (state.page + 1) * PAGE_SIZE >= Math.min(total, 10000)) { state.qi++; state.page = 0; }
    else state.page++;

    await new Promise((s) => setTimeout(s, 300));
  }

  await db.from("sweep_state").upsert({ key: stateKey, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });

  // substituição contínua: aposenta linhas Tubular re-encontradas pelo IC (nome + sanidade de seguidores)
  let substituidas = null;
  try { const { data } = await db.rpc("dedup_prospects"); substituidas = data; } catch {}

  // auto-encadeamento: dispara a próxima invocação (máx 40 elos) até concluir ou bater o piso
  const chain = Number(sp.get("chain")) || 0;
  if (chain > 0 && chain < 40 && !state.done && !stopReason) {
    const base = new URL(req.url).origin;
    await fetch(`${base}/api/ic-sweep?chain=${chain + 1}&floor=${floor}${masc ? "&masc=1" : ""}&elo=${Date.now()}`, { headers: internalHeaders(), signal: AbortSignal.timeout(1500) }).catch(() => {});
  }

  const { count } = await db.from("prospects").select("tubular_id", { count: "exact", head: true });
  const { count: icCount } = await db.from("prospects").select("tubular_id", { count: "exact", head: true }).eq("fonte", "influencers_club");
  return NextResponse.json({
    done: !!state.done, consulta_atual: state.qi < state.queue.length ? state.queue[state.qi] : null,
    consultas_feitas: state.qi, consultas_total: state.queue.length,
    paginas_agora: pagesNow, inseridos_agora: insertedNow, inseridos_total: state.inserted,
    prospects_no_banco: count, vindos_do_ic: icCount, tubular_substituidas: substituidas, credits_left: creditsLeft, parou_por: stopReason, lastErr,
  });
}
