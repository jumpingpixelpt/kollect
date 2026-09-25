import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { funnelMiniScore } from "@/lib/score";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATE_KEY = "sweep_v2";
const API = "https://tubularlabs.com/api";
const LEAF = 950; // banda cabe em 2 lotes de 500

let lastCall = 0;
async function tb(endpoint, body) {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((s) => setTimeout(s, wait));
  lastCall = Date.now();
  const r = await fetch(`${API}${endpoint}`, {
    method: "POST",
    headers: { "Api-Key": process.env.TUBULAR_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${endpoint} ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

const v3Body = (lo, hi, size, token) => ({
  query: { include_filter: { creator_genres: [23], creator_countries: ["BR"], creator_views: { min: lo, max: hi } } },
  fields: ["creator_id", "title", "thumbnail_url", "country", "genre", "views", "uploads_90d"],
  scroll: token ? { scroll_size: size, scroll_token: token } : { scroll_size: size },
});

// mesma régua do funil para todas as fontes — ver a nota em /api/discover
const miniScore = (pf) => funnelMiniScore({
  engPct: pf.views > 0 ? (pf.engagements / pf.views) * 100 : 0,
  followers: pf.followers,
  growthPct: pf.followers_growth != null ? pf.followers_growth * 100 : null,
});

/**
 * GET /api/sweep — varredura completa do universo Beauty BR.
 * Fase A: enumera os ~20.6k via v3 creator.search particionando por faixas de
 *   creator_views (split geométrico até a banda caber em 2 lotes de 500).
 * Fase B: enriquece followers/growth/eng via v4 creator.search por lotes de ids.
 * Estado persiste em sweep_state; chamar até done=true. ?reset=1 recomeça.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

async function run(req) {
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const db = supabaseAdmin();
  const t0 = Date.now();
  const timeLeft = () => 240000 - (Date.now() - t0);

  if (sp.get("reset")) await db.from("sweep_state").delete().eq("key", STATE_KEY);

  const { data: st } = await db.from("sweep_state").select("value").eq("key", STATE_KEY).maybeSingle();
  const state = st?.value ?? { stack: [[0, 2000000000000]], enumerated: 0, bands: 0 };
  let calls = 0, upserted = 0, enriched = 0, lastErr = null;

  // ─── FASE A: enumerar por bandas de views ────────────────────────────────
  while (state.stack?.length && timeLeft() > 15000) {
    const [lo, hi] = state.stack.pop();
    let probe;
    try { probe = await tb("/v3/creator.search", v3Body(lo, hi, 1)); calls++; }
    catch (e) { lastErr = String(e).slice(0, 200); state.stack.push([lo, hi]); break; }
    const total = probe.total ?? 0;
    if (total === 0) continue;

    if (total > LEAF && hi > lo) {
      let mid = Math.floor(Math.sqrt((lo + 1) * hi));
      if (mid <= lo) mid = lo + 1;
      if (mid >= hi) mid = hi - 1;
      state.stack.push([mid + 1, hi], [lo, mid]);
      continue;
    }

    // banda-folha: busca até 2 lotes de 500
    const rows = [];
    try {
      const b1 = await tb("/v3/creator.search", v3Body(lo, hi, 500)); calls++;
      const list1 = b1.creators ?? b1.results ?? [];
      let list2 = [];
      if (b1.scroll_token && list1.length === 500 && total > 500) {
        const b2 = await tb("/v3/creator.search", v3Body(lo, hi, 500, b1.scroll_token)); calls++;
        list2 = b2.creators ?? b2.results ?? [];
      }
      for (const c of [...list1, ...list2]) {
        if (!c.creator_id) continue;
        rows.push({
          tubular_id: c.creator_id,
          name: c.title ?? null,
          thumbnail: c.thumbnail_url && !/tubularlabs\.com/.test(c.thumbnail_url) ? c.thumbnail_url : null,
          country: c.country ?? "BR",
          genre: c.genre?.title ?? "Beauty",
          views_total: c.views ?? null,
          uploads_90: c.uploads_90d ?? null,
          termo: "sweep",
        });
      }
    } catch (e) { lastErr = String(e).slice(0, 200); state.stack.push([lo, hi]); break; }

    if (rows.length) {
      const { error } = await db.from("prospects").upsert(rows, { onConflict: "tubular_id", ignoreDuplicates: false });
      if (error) lastErr = String(error.message).slice(0, 200);
      else { upserted += rows.length; state.enumerated += rows.length; state.bands++; }
    }
  }

  // ─── FASE B: enriquecer com performance (v4 por ids) ─────────────────────
  if (!state.stack?.length) {
    while (timeLeft() > 15000) {
      const { data: pend } = await db.from("prospects").select("tubular_id").is("followers", null).limit(100);
      if (!pend?.length) { state.done = true; break; }
      const ids = pend.map((p) => p.tubular_id);
      let body;
      try {
        body = await tb("/v4/creator.search", {
          include: { ids },
          fields: { snippet: true, performance: true, taxonomy: true },
          scroll: { size: 100 },
        });
        calls++;
      } catch (e) { lastErr = String(e).slice(0, 200); break; }

      const got = new Set();
      const ups = [];
      for (const r of body.results ?? []) {
        const tx = r.taxonomy || {}, pf = r.performance || {};
        got.add(r.id);
        ups.push({
          tubular_id: r.id,
          followers: pf.followers ?? 0,
          followers_30: pf.followers_30 ?? null,
          growth_30: pf.followers_growth != null ? Math.round(pf.followers_growth * 10000) / 100 : null,
          eng_rate: pf.views > 0 ? Math.round((pf.engagements / pf.views) * 10000) / 100 : null,
          uploads_30: pf.uploads_30 ?? null,
          last_upload: pf.last_upload ?? null,
          rising_star: tx.rising_star ?? null,
          mini_score: miniScore(pf),
        });
      }
      // ids que a v4 não devolveu: marca followers=0 pra não re-tentar eternamente
      for (const id of ids) if (!got.has(id)) ups.push({ tubular_id: id, followers: 0, mini_score: 0 });
      const { error } = await db.from("prospects").upsert(ups, { onConflict: "tubular_id", ignoreDuplicates: false });
      if (error) { lastErr = String(error.message).slice(0, 200); break; }
      enriched += got.size;
    }
  }

  await db.from("sweep_state").upsert({ key: STATE_KEY, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
  const { count } = await db.from("prospects").select("tubular_id", { count: "exact", head: true });
  const { count: semPerf } = await db.from("prospects").select("tubular_id", { count: "exact", head: true }).is("followers", null);
  return NextResponse.json({
    done: !!state.done, fase: state.stack?.length ? "A_enumeracao" : state.done ? "concluida" : "B_performance",
    bandas_processadas: state.bands, faixas_pendentes: state.stack?.length ?? 0,
    upserted_agora: upserted, enriquecidos_agora: enriched, calls,
    prospects_no_banco: count, aguardando_performance: semPerf, lastErr,
  });
}
