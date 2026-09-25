import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tubularPost } from "@/lib/tubular";
import { internalHeaders } from "@/lib/internal-fetch";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx — backfill de histórico via /v4/creator.monthly_trends da Tubular:
 * substitui os snapshots antigos pela série mensal real (seguidores, views, engajamento)
 * e recalcula o score. Liga Momentum, classificação e forecast com curva de verdade.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 503 });
  const handle = new URL(req.url).searchParams.get("handle");
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("id, handle, platform, tubular_id").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 404 });
  if (!c.tubular_id) return NextResponse.json({ error: "creator sem tubular_id — rode /api/tubular-sync antes" }, { status: 422 });

  const body = await tubularPost("/v4/creator.monthly_trends", { include: { ids: [c.tubular_id] } });
  const trends = (body.results?.[0]?.trends ?? [])
    .filter((t) => t.platform === c.platform && t.followers?.all_time)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!trends.length) return NextResponse.json({ error: "sem série mensal pra essa plataforma", got: body.results?.[0]?.trends?.length ?? 0 }, { status: 422 });

  const thisMonth = new Date().toISOString().slice(0, 7);
  const rows = trends
    .filter((t) => t.month < thisMonth) // o mês corrente fica por conta do snapshot diário
    .map((t) => ({
      creator_id: c.id,
      captured_at: `${t.month}-28`,
      followers: t.followers.all_time,
      avg_views: t.aggregated?.views_30_days ?? null,
      eng_rate: t.aggregated?.engagement_rate ?? null,
    }));

  // substitui o histórico antigo (mantém o snapshot de hoje, que é o mais fresco)
  const today = new Date().toISOString().slice(0, 10);
  await db.from("snapshots").delete().eq("creator_id", c.id).lt("captured_at", today);
  const { error } = await db.from("snapshots").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await fetch(new URL(`/api/score?handle=${encodeURIComponent(c.handle)}`, req.url), { method: "POST", headers: internalHeaders() }).catch(() => {});
  return NextResponse.json({
    creator: c.handle, platform: c.platform,
    meses_backfillados: rows.length,
    de: rows[0]?.captured_at, ate: rows.at(-1)?.captured_at,
    followers_inicio: rows[0]?.followers, followers_fim: rows.at(-1)?.followers,
  });
}
