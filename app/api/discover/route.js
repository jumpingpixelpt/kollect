import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { tubularPost } from "@/lib/tubular";
import { funnelMiniScore } from "@/lib/score";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TERMOS = ["maquiagem", "skincare", "cabelo", "beleza", "make tutorial", "resenha maquiagem", "cabelo crespo", "unhas", "perfume", "autocuidado", "batom", "pele oleosa", "cachos", "nail art", "glow", "rotina de skincare", "make iniciante", "cabelo loiro", "dicas de beleza", "maquiadora"];

/**
 * GET ?min=3000&max=250000 — descoberta de prospects beauty BR via Tubular:
 * varre termos de busca, filtra (BR + Beauty + faixa de seguidores), calcula
 * mini-score barato (sem IA) e grava na tabela prospects.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

// Adapta o `performance` da Tubular ao funnelMiniScore de lib/score.js.
//
// Havia aqui uma cópia local com pesos PRÓPRIOS (crescimento + engajamento + cadência +
// frescura, tecto 100) e outra igual no /api/sweep. O resultado é que a mesma coluna
// `prospects.mini_score` guardava notas de duas réguas diferentes conforme a fonte, e o
// /termometro filtra por mini_score >= 50 sobre a mistura das duas. Passa a haver uma só
// fórmula — a do lib/score.js, que é a que o funil do IC sempre usou.
const miniScore = (pf) => funnelMiniScore({
  engPct: pf.views > 0 ? (pf.engagements / pf.views) * 100 : 0,
  followers: pf.followers,
  growthPct: pf.followers_growth != null ? pf.followers_growth * 100 : null,
});

async function run(req) {
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const min = Number(sp.get("min")) || 3000;
  const max = Number(sp.get("max")) || 250000;

  const db = supabaseAdmin();
  const vistos = new Set();
  let inseridos = 0, candidatos = 0;

  for (const termo of TERMOS) {
    let body;
    try {
      body = await tubularPost("/v4/creator.search", {
        include: { search: termo },
        fields: { snippet: true, performance: true, taxonomy: true },
        scroll: { size: 100 },
      });
    } catch { continue; }

    for (const r of body.results ?? []) {
      candidatos++;
      const tx = r.taxonomy || {}, pf = r.performance || {};
      if (vistos.has(r.id)) continue;
      if (tx.country !== "BR") continue;
      if ((tx.genre?.id ?? 0) !== 23) continue;             // Beauty
      if (!pf.followers || pf.followers < min || pf.followers > max) continue;
      vistos.add(r.id);

      const row = {
        tubular_id: r.id,
        name: r.snippet?.title ?? null,
        thumbnail: r.snippet?.thumbnail ?? null,
        country: tx.country,
        genre: tx.genre?.title ?? null,
        followers: pf.followers,
        followers_30: pf.followers_30 ?? null,
        growth_30: pf.followers_growth != null ? Math.round(pf.followers_growth * 10000) / 100 : null,
        eng_rate: pf.views > 0 ? Math.round((pf.engagements / pf.views) * 10000) / 100 : null,
        uploads_30: pf.uploads_30 ?? null,
        last_upload: pf.last_upload ?? null,
        rising_star: tx.rising_star ?? null,
        mini_score: miniScore(pf),
        termo,
      };
      const { error } = await db.from("prospects").upsert(row, { onConflict: "tubular_id", ignoreDuplicates: false });
      if (!error) inseridos++;
    }
  }

  const { data: top } = await db.from("prospects").select("name, followers, growth_30, eng_rate, mini_score")
    .order("mini_score", { ascending: false }).limit(15);
  return NextResponse.json({ candidatos_varridos: candidatos, prospects_gravados: inseridos, top15: top });
}
