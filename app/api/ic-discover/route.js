import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { funnelMiniScore } from "@/lib/score";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://api-dashboard.influencers.club";
const PAGE_SIZE = 50;

// Descoberta dirigida pelo influencers.club — DESLIGADA por omissão (decisão do cliente,
// jul/2026 — post-mortem dos créditos). Mesma razão do ic-sweep: no IC cada perfil revelado
// custa crédito, e o piso daqui (`floor`, default 6000) só é avaliado depois da resposta já
// paga, deixando escapar uma página de 50 perfis por invocação. O IC fica reservado à
// demografia de audiência. Para reabrir conscientemente: IC_DISCOVERY_ENABLED=1.
const DESCOBERTA_LIGADA = process.env.IC_DISCOVERY_ENABLED === "1";

// termos de legenda do território fino/volume/queda (do seed do Nelson)
const CAP_DEFAULT = ["cabelo fino", "cabelos finos", "cabelo ralo", "queda de cabelo", "afinamento capilar", "meu cabelo afinou", "volume capilar", "cabelo encorpado", "raiz com volume", "produto para cabelo fino"];

async function discover(platform, term, page) {
  const filters = { location: ["Brazil"], number_of_followers: { min: 3000, max: 500000 }, keywords_in_captions: [term] };
  const r = await fetch(`${BASE}/public/v1/discovery/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ platform, paging: { limit: PAGE_SIZE, page }, sort: { sort_by: "relevancy", sort_order: "desc" }, filters }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`discovery ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

/** GET /api/ic-discover?cap=cabelo fino,volume capilar&platforms=instagram,tiktok&pages=1&floor=8000 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
    if (!DESCOBERTA_LIGADA) {
      return NextResponse.json({
        error: "descoberta via influencers.club desligada (decisão de jul/2026: o IC fica reservado à demografia de audiência). Use o Apify — /api/sweep, promote-apify, promote-tiktok. Para reabrir: IC_DISCOVERY_ENABLED=1.",
        rota: "ic-discover",
      }, { status: 200 });
    }
    const sp = new URL(req.url).searchParams;
    const caps = (sp.get("cap") ? sp.get("cap").split(",") : CAP_DEFAULT).map((t) => t.trim()).filter(Boolean);
    const platforms = (sp.get("platforms") ? sp.get("platforms").split(",") : ["instagram", "tiktok"]).map((p) => p.trim());
    const pages = Math.min(Number(sp.get("pages")) || 1, 4);
    const floor = Number(sp.get("floor")) || 6000;
    const db = supabaseAdmin();
    const t0 = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    let inserted = 0, creditsLeft = null, stop = null;
    const perTerm = [], errors = [];

    outer:
    for (const platform of platforms) {
      for (const term of caps) {
        let got = 0;
        for (let page = 0; page < pages; page++) {
          if (Date.now() - t0 > 230000) { stop = "tempo"; break outer; }
          let body;
          try { body = await discover(platform, term, page); }
          catch (e) { errors.push(`${platform}/${term} p${page}: ${String(e).slice(0, 120)}`); break; }
          creditsLeft = Number(body.credits_left ?? creditsLeft);
          if (!Number.isNaN(creditsLeft) && creditsLeft < floor) { stop = `piso de créditos (${creditsLeft} < ${floor})`; break outer; }
          const accounts = body.accounts ?? [];
          const rows = accounts.map((a) => {
            const tid = `ic_${platform === "tiktok" ? "tt" : "ig"}_${a.user_id}`;
            const followers = a.profile?.followers ?? null;
            const engPct = a.profile?.engagement_percent != null ? Math.round(a.profile.engagement_percent * 100) / 100 : null;
            return {
              tubular_id: tid, name: a.profile?.full_name || a.profile?.username || null, handle: a.profile?.username ?? null,
              platform, thumbnail: a.profile?.picture ?? null, country: "BR", genre: "Cabelo fino/volume (IC)",
              followers, eng_rate: engPct, termo: `cap:${term}`, fonte: "influencers_club",
              followers_prev: followers, followers_at: today,
              mini_score: funnelMiniScore({ engPct, followers, growthPct: null }),
            };
          }).filter((r) => r.handle && r.followers);
          if (rows.length) {
            const { error } = await db.from("prospects").upsert(rows, { onConflict: "tubular_id", ignoreDuplicates: false });
            if (error) errors.push(`upsert ${term}: ${String(error.message).slice(0, 100)}`);
            else { inserted += rows.length; got += rows.length; }
          }
          if (accounts.length < PAGE_SIZE) break;
          await new Promise((s) => setTimeout(s, 250));
        }
        perTerm.push({ platform, term, got });
      }
    }
    return NextResponse.json({ inserted, creditsLeft, stop, perTerm, errors });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
