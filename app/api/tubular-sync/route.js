import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { engRateViews } from "@/lib/engagement";
import { searchCreatorByProfile, getVideosByCreator, mapCategory, nicheLabel, tubularPost } from "@/lib/tubular";
import { internalHeaders } from "@/lib/internal-fetch";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx — sincroniza um creator com a Tubular:
 * atualiza perfil + snapshot do dia + grava os top vídeos (métricas) e recalcula o score.
 */
// erro sempre em JSON (convenção da app): um 500 com HTML rebentava o JSON.parse
// do orquestrador e mascarava a causa — foi o que aconteceu com o bug do growth30
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 503 });
  const handle = new URL(req.url).searchParams.get("handle");
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("id, handle, platform, tubular_id").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 404 });

  const profile = await searchCreatorByProfile(c.platform, c.handle);
  if (!profile) return NextResponse.json({ error: "Tubular não encontrou o perfil" }, { status: 422 });

  // followers da plataforma específica (o total do perfil soma todas as redes)
  let followers = profile.performance?.followers ?? null;
  try {
    const mt = await tubularPost("/v4/creator.monthly_trends", { include: { ids: [profile.id] } });
    const series = (mt.results?.[0]?.trends ?? [])
      .filter((t) => t.platform === c.platform && t.followers?.all_time)
      .sort((a, b) => b.month.localeCompare(a.month));
    if (series[0]?.followers?.all_time) followers = series[0].followers.all_time;
  } catch {}
  // A janela de 90 dias define o RITMO ATUAL (views médias e engajamento do snapshot) e
  // não muda. O que mudou: ela era também a ÚNICA fonte da tabela `videos`, por isso um
  // creator sem posts indexados nos últimos 90 dias ficava com a dobra "Proof" vazia e
  // sem nada para o deep-scan analisar — enquanto o brand-scan, que olha 365 dias atrás,
  // via o ano inteiro de conteúdo. Para as PEÇAS a mostrar, alarga-se para 365 dias
  // quando a janela curta vem vazia; as MÉTRICAS continuam só com os recentes.
  let erroVideos = null;
  const capturar = (daysBack) =>
    getVideosByCreator(profile.id, { platforms: [c.platform], size: 10, daysBack })
      .catch((e) => { erroVideos = String(e?.message || e).slice(0, 160); return []; });
  const recentes = await capturar(90);
  const vids = recentes.length ? recentes : await capturar(365);
  const views = recentes.map((v) => v.views || 0).filter(Boolean);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avgViews = views.length ? Math.round(sum(views) / views.length) : (profile.performance?.views_per_upload ? Math.round(profile.performance.views_per_upload) : null);
  const pf = profile.performance || {};
  const growth30 = pf.followers_growth ?? null; // fração (0.05 = +5%/30d), como no sweep
  const vidEng = sum(recentes.map((v) => v.engagements?.total || 0));
  const vidViews = sum(recentes.map((v) => v.views || 0));
  // engajamento SEMPRE eng/views (decisão do cliente): amostra de vídeos > nível perfil; sem fallback por seguidores
  const engRate = engRateViews(vidEng, vidViews) ?? engRateViews(pf.engagements, pf.views);

  await db.from("creators").update({
    followers: followers ?? undefined,
    tubular_id: profile.id,
    niche: nicheLabel(profile.taxonomy) ?? undefined,
    category: mapCategory(profile.taxonomy),
    avatar_url: profile.snippet?.thumbnail ?? undefined,
  }).eq("id", c.id);
  // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
  if (profile.snippet?.thumbnail) await guardarAvatar(db, c.id, profile.snippet.thumbnail);

  if (followers) {
    const { data: prev } = await db.from("snapshots").select("followers")
      .eq("creator_id", c.id).lt("captured_at", new Date().toISOString().slice(0, 10))
      .order("captured_at", { ascending: false }).limit(1);
    const stale = prev?.[0]?.followers === followers;
    await db.from("snapshots").delete().eq("creator_id", c.id).eq("captured_at", new Date().toISOString().slice(0, 10));
    if (!stale) {
      await db.from("snapshots").insert({
        creator_id: c.id, captured_at: new Date().toISOString().slice(0, 10),
        followers, avg_views: avgViews, eng_rate: engRate,
      });
    }
  }

  let saved = 0;
  for (const v of vids.slice(0, 8)) {
    if (!v.video_url) continue;
    const bd = v.engagements?.breakdown?.[0] ?? {};
    let thumb = v.thumbnail_url ?? null;
    if (thumb && thumb.includes("tubularlabs.com")) thumb = null; // proxy deles exige login
    if (!thumb && c.platform === "tiktok") {
      try {
        const oe = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(v.video_url)}`).then((r) => r.json());
        thumb = oe?.thumbnail_url ?? null;
      } catch {}
    }
    // Atualiza as MÉTRICAS sem destruir o que já foi pago: transcript, analysis,
    // content_score e saves ficam intactos. Antes era delete+insert, o que apagava a
    // análise do Gemini e obrigava a re-analisar (e re-pagar) o mesmo vídeo a cada sync.
    const metricas = {
      title: (v.title || v.description || "Vídeo").slice(0, 90),
      views: v.views ?? null,
      likes: bd.likes ?? null, comments: bd.comments ?? null, shares: bd.shares ?? null,
      posted_at: (v.publish_date || "").slice(0, 10) || null,
      ...(thumb ? { thumb } : {}),
    };
    const { data: existente } = await db.from("videos")
      .select("id").eq("creator_id", c.id).eq("url", v.video_url).maybeSingle();
    const { error } = existente
      ? await db.from("videos").update(metricas).eq("id", existente.id)
      : await db.from("videos").insert({ creator_id: c.id, url: v.video_url, saves: null, ...metricas });
    if (error) erroVideos = error.message.slice(0, 160); else saved++;
  }

  // o /api/score exige o bearer do cron quando CRON_SECRET existe — sem ele o recálculo
  // falhava em silêncio (o .catch engolia o 401)
  await fetch(new URL(`/api/score?handle=${encodeURIComponent(c.handle)}`, req.url), {
    method: "POST",
    headers: { ...internalHeaders(), ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) },
  }).catch(() => {});

  // `videos_salvos: 0` sozinho não dizia se a Tubular não devolveu nada, se falhou, ou se
  // o insert é que rebentou — e a dobra "Proof" vazia não tinha explicação em lado nenhum.
  return NextResponse.json({
    creator: c.handle, tubular_id: profile.id, followers,
    growth_30d_pct: growth30 != null ? Math.round(growth30 * 1000) / 10 : null,
    eng_rate: engRate, avg_views: avgViews, videos_salvos: saved,
    videos_encontrados: vids.length, janela_videos: recentes.length ? "90d" : "365d (sem posts recentes)",
    ...(erroVideos ? { erro_videos: erroVideos } : {}),
  });
}
