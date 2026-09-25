import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase";
import { engRateViews } from "@/lib/engagement";
import { searchCreatorByProfile, getVideosByCreator, mapCategory, nicheLabel } from "@/lib/tubular";
import { categoriaPorTexto, textoParaCategoria } from "@/lib/categoria";
import { erroPublico } from "@/lib/erro-publico";
import { guardarAvatar } from "@/lib/avatar-store";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const maxDuration = 300;

// A tabela de regras vivia aqui dentro, duplicando a lógica que o promote-* precisava e não
// tinha. Passou para lib/categoria.js, junto das outras regras de negócio. Diferença de
// comportamento assumida: onde antes caía em "lifestyle" por omissão, agora devolve null —
// que é o que a RPC ingest_profile entende por "não sei" e preserva, em vez de sobrescrever
// com um palpite. Ver a nota no cabeçalho de lib/categoria.js.

/**
 * Persiste as peças que a avaliação por link JÁ foi buscar à Tubular.
 *
 * Estes vídeos eram lidos só para calcular as views médias e a seguir deitados fora: o
 * creator nascia com zero linhas em `videos`, a dobra "Proof" da ficha ficava vazia e o
 * deep-scan (que lê desta tabela) não tinha nada para analisar. Ficava tudo dependente do
 * `/api/enrich` → `tubular-sync` correr depois — um passo separado que, se falhar, deixa a
 * ficha meia-vazia sem explicação (foi o que aconteceu ao @principealeff, jul/2026).
 *
 * Só grava quando ainda não há peças: numa reavaliação do mesmo creator, apagar e reinserir
 * destruiria transcript/analysis/content_score já pagos ao Gemini.
 *
 * A thumb da Tubular é sempre um proxy em tubularlabs.com que exige login, por isso é
 * descartada — o /api/thumb resolve a imagem do TikTok pelo `fb` (URL do vídeo) na altura
 * de renderizar, e assim a importação não fica presa a 8 chamadas ao oembed.
 */
async function guardarVideos(cid, vids) {
  if (!cid || !vids?.length) return 0;
  const { count } = await supabase.from("videos").select("id", { count: "exact", head: true }).eq("creator_id", cid);
  if (count) return 0;
  const linhas = vids.filter((v) => v.video_url).slice(0, 8).map((v) => {
    const bd = v.engagements?.breakdown?.[0] ?? {};
    const thumb = v.thumbnail_url && !v.thumbnail_url.includes("tubularlabs.com") ? v.thumbnail_url : null;
    return {
      creator_id: cid, url: v.video_url,
      title: (v.title || v.description || "Vídeo").slice(0, 90),
      views: v.views ?? null, likes: bd.likes ?? null, comments: bd.comments ?? null,
      shares: bd.shares ?? null, saves: null,
      posted_at: (v.publish_date || "").slice(0, 10) || null,
      ...(thumb ? { thumb } : {}),
    };
  });
  if (!linhas.length) return 0;
  const { error } = await supabase.from("videos").insert(linhas);
  return error ? 0 : linhas.length;
}

function parseUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.hostname.includes("instagram.com")) {
      const handle = u.pathname.split("/").filter(Boolean)[0];
      if (handle && !["p", "reel", "reels", "stories"].includes(handle)) return { platform: "instagram", handle };
    }
    if (u.hostname.includes("tiktok.com")) {
      const m = u.pathname.match(/@([\w.\-]+)/);
      if (m) return { platform: "tiktok", handle: m[1] };
    }
  } catch {}
  return null;
}

/**
 * POST { url } — avalia um perfil novo a partir do link:
 * Apify puxa perfil + posts recentes → métricas → ingest_profile cria creator,
 * snapshot e score provisório. Radar completo vem com as coletas seguintes.
 */
// Erros (feedback rodada 2, bug 1): o link vem do ecrã do cliente — falhas técnicas
// (Apify, RPC) saem só como mensagem amigável + ref; o detalhe fica nos logs.
async function seguro(url) {
  try { return await evaluate(url); }
  catch (e) { return NextResponse.json(erroPublico(e, "evaluate"), { status: 500 }); }
}

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "evaluate", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  const url = new URL(req.url).searchParams.get("url");
  return seguro(url);
}

export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "evaluate", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  const { url } = await req.json().catch(() => ({}));
  return seguro(url);
}

async function evaluate(url) {
  const parsed = parseUrl(url || "");
  if (!parsed) return NextResponse.json({ error: "Link inválido — cole a URL de um perfil do TikTok ou Instagram." }, { status: 400 });

  const { platform, handle } = parsed;

  // ── Fonte primária: Tubular Labs (já paga, rápida, com taxonomy) ──
  if (process.env.TUBULAR_API_KEY) {
    try {
      const t = await searchCreatorByProfile(platform, handle);
      if (t) {
        const followers = t.performance?.followers ?? null;
        const vids = await getVideosByCreator(t.id, { platforms: [platform], size: 15, daysBack: 60 }).catch(() => []);
        const views = vids.map((v) => v.views || 0).filter(Boolean);
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        const avgViews = views.length ? Math.round(sum(views) / views.length) : (t.performance?.views_per_upload ? Math.round(t.performance.views_per_upload) : null);
        const p_ = t.performance || {};
        const engRate = engRateViews(p_.engagements, p_.views); // SEMPRE eng/views
        if (followers) {
          const { data: cid, error } = await supabase.rpc("ingest_profile", {
            p_handle: handle, p_platform: platform,
            p_name: t.snippet?.title ?? handle,
            p_avatar: t.snippet?.thumbnail ?? null,
            p_bio: t.snippet?.description ?? null,
            p_followers: followers, p_avg_views: avgViews, p_eng: engRate,
            p_niche: nicheLabel(t.taxonomy) ?? "Avaliação por link",
            p_category: mapCategory(t.taxonomy),
            p_tubular_id: t.id,
          });
          if (!error) {
            // a foto enquanto o URL ainda é válido (rodada 2, bug 4) — nunca lança
            await guardarAvatar(supabase, cid, t.snippet?.thumbnail ?? null);
            const videos_gravados = await guardarVideos(cid, vids);
            return NextResponse.json({ id: cid, handle, platform, followers, eng_rate: engRate, source: "tubular", tubular_id: t.id, videos_amostrados: vids.length, videos_gravados });
          }
        }
      }
    } catch (e) { /* cai pro Apify */ }
  }

  // ── Fallback: Apify ──
  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json(erroPublico(new Error("evaluate: nem TUBULAR_API_KEY nem APIFY_TOKEN disponíveis"), "evaluate"), { status: 503 });
  const actor = platform === "tiktok" ? "clockworks~tiktok-scraper" : "apify~instagram-profile-scraper";
  const input = platform === "tiktok"
    ? { profiles: [handle], resultsPerPage: 12, shouldDownloadVideos: false }
    : { usernames: [handle] };

  const items = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=180`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  ).then((r) => r.json());

  const p = Array.isArray(items) ? items[0] : null;
  if (!p) return NextResponse.json({ error: "Não conseguimos ler esse perfil — confira o link." }, { status: 422 });

  const followers = p.followersCount ?? p.authorMeta?.fans ?? p.fans ?? null;
  if (!followers) return NextResponse.json({ error: "Perfil sem contagem de seguidores acessível (pode ser privado)." }, { status: 422 });
  const name = p.fullName ?? p.authorMeta?.nickName ?? handle;
  const avatar = p.profilePicUrlHD ?? p.profilePicUrl ?? p.authorMeta?.avatar ?? null;
  const bio = p.biography ?? p.authorMeta?.signature ?? null;

  // métricas dos posts recentes
  const posts = platform === "tiktok"
    ? (Array.isArray(items) ? items.filter((i) => i.playCount != null) : [])
    : (p.latestPosts || []);
  const views = posts.map((v) => v.playCount ?? v.videoViewCount ?? v.videoPlayCount ?? 0).filter(Boolean);
  const likes = posts.map((v) => v.diggCount ?? v.likesCount ?? 0);
  const comments = posts.map((v) => v.commentCount ?? v.commentsCount ?? 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avgViews = views.length ? Math.round(sum(views) / views.length) : null;
  const engRate = engRateViews(sum(likes) + sum(comments), sum(views)); // SEMPRE eng/views

  const category = categoriaPorTexto(textoParaCategoria(bio, posts.map((v) => v.text || v.caption)));

  const { data: cid, error } = await supabase.rpc("ingest_profile", {
    p_handle: handle, p_platform: platform, p_name: name, p_avatar: avatar, p_bio: bio,
    p_followers: followers, p_avg_views: avgViews, p_eng: engRate,
    p_niche: "Avaliação por link", p_category: category, p_tubular_id: null,
  });
  if (error) return NextResponse.json(erroPublico(new Error(`ingest_profile: ${error.message}`), "evaluate"), { status: 500 });
  await guardarAvatar(supabase, cid, avatar);

  return NextResponse.json({ id: cid, handle, platform, followers, eng_rate: engRate });
}
