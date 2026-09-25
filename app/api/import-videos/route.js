import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { engRateViews } from "@/lib/engagement";
import { atualizarMetricasRede } from "@/lib/metricas-rede";
import { exigirSessao, autorizadoAdmin } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Importa os vídeos de um creator que JÁ EXISTE — a peça que faltava no funil.
 *
 * GET ?handle=xxx [&snapshot=1] [&force=1] [&debug=1]
 *
 * Havia rotas que gravam vídeos, e nenhuma servia este caso:
 *  · /api/tubular-sync exige tubular_id;
 *  · /api/evaluate parece fazê-lo, mas o guardarVideos() só grava o que vem da TUBULAR —
 *    para um creator só-Instagram corre sem erro e grava ZERO (medido no @victtoramori,
 *    02/09), e o brand-scan a seguir responde "sem legendas";
 *  · /api/promote-apify e /api/promote-tiktok fazem exactamente a raspagem certa, mas
 *    estão presas ao fluxo prospect→creator: pedem um prospect, criam a creator, escrevem
 *    snapshots e trilho. Não servem quem já está na base.
 *
 * Esta rota raspa os últimos posts no Apify e grava-os em `videos`. Sem isto, 85 creators
 * do radar não tinham uma única legenda e o território deles não podia ser lido por ninguém.
 *
 * ACRESCENTA, NUNCA APAGA (set/2026). Nasceu a gravar só em quem não tinha peças, porque
 * foi feita para esses 85. Mas as peças de toda a base são importadas uma vez, na promoção,
 * e envelhecem: a 03/09 só 44 de 2.099 creators tinham uma peça dos últimos 30 dias, e o
 * scorecard da ficha caía quase sempre nas "últimas 12 peças". Agora o caminho normal é o da
 * atualização: as peças que ainda não estão na base entram; as que já estão recebem views,
 * likes e comentários frescos; transcript e `analysis` — trabalho pago ao Whisper e ao
 * Gemini, que não se recupera — nunca são tocados. A tabela não tem chave única por URL (a
 * Tubular grava tiktok.com/@redirect-to/video/ID e o Apify o @ real), por isso a identidade
 * é o id do vídeo no TikTok e o código do post no Instagram (chaveUrl).
 *
 * ?snapshot=1 aproveita a MESMA raspagem para gravar o snapshot do dia — seguidores, views
 * médias, taxa de engajamento (engajamentos ÷ views, lib/engagement.js) — e atualizar os
 * seguidores da creator, com as fórmulas do /api/cron/collect. Sem isto, renovar métricas
 * e renovar peças eram duas chamadas ao Apify para o mesmo perfil.
 *
 * ?force=1 é o caminho antigo, delete + insert, e continua a recusar-se quando há análises.
 */
async function apify(actor, input, timeout = 180) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

// Legendas do TikTok e do Instagram vêm com emojis, e um corte a 500 caracteres pode cair
// no meio de um par de surrogates: o JSON fica com um surrogate solto e o Postgres recusa a
// linha inteira ("invalid input syntax for type json" — aconteceu ao @kaumonteiiro, 03/09).
// Limpa-se antes e depois do corte; o brand-scan já fazia o mesmo às legendas que lê.
const limpa = (s) => String(s ?? "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
const corta = (s, n) => limpa(limpa(s).slice(0, n));

/** Identidade de uma peça independentemente da forma do URL (ver cabeçalho). */
function chaveUrl(u) {
  if (!u) return null;
  const tk = String(u).match(/\/video\/(\d+)/);
  if (tk) return `tk:${tk[1]}`;
  const ig = String(u).match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (ig) return `ig:${ig[1]}`;
  return String(u).replace(/[?#].*$/, "").replace(/\/$/, "");
}

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "import-videos", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

async function run(req) {
  if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const handle = (sp.get("handle") || "").trim().replace(/^@/, "");
  // ?force=1 re-paga o Apify e reescreve o que já está guardado: só admin ou o sistema
  // (pentest set/2026, "Business Logic Bypass"); para os outros é ignorado
  const privilegiado = await autorizadoAdmin(req);
  const force = sp.get("force") === "1" && privilegiado;
  const comSnapshot = sp.get("snapshot") === "1";
  if (!handle) return NextResponse.json({ error: "falta ?handle=" }, { status: 200 });

  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("id, handle, platform").eq("handle", handle).maybeSingle();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });

  // o que já lá está — e o que dele é caro
  const { data: atuais } = await db.from("videos").select("id, url, transcript, analysis").eq("creator_id", c.id);
  const comAnalise = (atuais ?? []).filter((v) => v.analysis || v.transcript).length;
  if (force && comAnalise) {
    return NextResponse.json({ error: `recusado: ${comAnalise} vídeos têm transcrição ou análise do Gemini — reimportar destruiria trabalho pago`, handle, videos: atuais.length });
  }

  let vids = [];
  let perfil = null; // seguidores e avatar da mesma raspagem, para o snapshot
  if (c.platform === "tiktok") {
    // 30 e não 15 (feedback do cliente, set/2026: janela de 90 dias; custo aceite pelo Rui a 11/09)
    const items = await apify("clockworks~tiktok-scraper", { profiles: [handle], resultsPerPage: 30, shouldDownloadVideos: false, shouldDownloadCovers: false }, 180);
    const a = items.find((v) => v.authorMeta)?.authorMeta;
    perfil = { followers: Number(a?.fans) || null, avatar: a?.avatar ?? null };
    vids = items
      .filter((v) => v.playCount != null || v.webVideoUrl)
      .map((v) => ({
        creator_id: c.id, url: v.webVideoUrl ?? null, tipo: "video",
        title: corta(v.text, 500) || null,
        views: Number(v.playCount) || null, likes: Number(v.diggCount) || null,
        comments: Number(v.commentCount) || null, shares: Number(v.shareCount) || null,
        saves: Number(v.collectCount) || null,
        posted_at: v.createTimeISO ? v.createTimeISO.slice(0, 10) : null,
      }));
  } else {
    const items = await apify("apify~instagram-profile-scraper", { usernames: [handle] }, 180);
    const p = items[0];
    if (!p) return NextResponse.json({ error: "apify não devolveu perfil (privado ou inexistente)", handle }, { status: 200 });
    perfil = { followers: Number(p.followersCount) || null, avatar: p.profilePicUrlHD ?? p.profilePicUrl ?? null };
    // ?debug=1 — o que o actor devolveu, sem escrever nada. Existe porque "sem vídeos
    // públicos" tem duas causas diferentes (o perfil não tem posts vs. os posts não são
    // vídeos) e do lado de cá não se distinguem.
    if (sp.get("debug") === "1" && privilegiado) {
      const posts = p.latestPosts || [];
      const tipos = {};
      for (const v of posts) tipos[v.type || "?"] = (tipos[v.type || "?"] || 0) + 1;
      return NextResponse.json({
        handle, privado: p.private ?? null, posts_total: posts.length, tipos,
        com_caption: posts.filter((v) => (v.caption || "").trim().length > 3).length,
        amostra: posts.slice(0, 3).map((v) => ({ type: v.type, url: (v.url || "").slice(0, 60), caption: (v.caption || "").slice(0, 80) })),
      });
    }
    // FOTOS TAMBÉM. O promote-apify filtra a vídeos e reels porque mede performance de
    // vídeo; aqui o objectivo é outro — dar legendas ao brand-scan, que é quem lê o
    // território. Medido a 02/09: o @victtoramori tem 7 posts, todos Image/Sidecar, e as 7
    // legendas dizem o território ("EXOSOME THERAPY", "Aesthetics Clinic"). Filtrar vídeo
    // aqui era deitar fora a única evidência que estes creators têm. O `tipo` mantém-nas
    // fora do deep-scan, que só analisa vídeo (migração videos_tipo_imagem_ou_video).
    const ehVideo = (v) => v.type === "Video" || v.videoViewCount != null || v.videoPlayCount != null || /\/reel\//.test(v.url || "");
    // O profile-scraper só traz os últimos 12 posts. Para a janela de 90 dias (feedback do
    // cliente, set/2026) o post-scraper vai buscar até 30; se falhar, ficam os 12 do perfil.
    let posts = p.latestPosts || [];
    try {
      const mais = await apify("apify~instagram-post-scraper", { username: [handle], resultsLimit: 30, skipPinnedPosts: false }, 180);
      if (mais.length > posts.length) posts = mais;
    } catch { /* quota ou perfil privado — os 12 do perfil chegam */ }
    vids = posts.slice(0, 30)
      .filter((v) => (v.caption || "").trim().length > 3 || ehVideo(v))
      .map((v) => ({
        creator_id: c.id, url: v.url ?? null,
        tipo: ehVideo(v) ? "video" : "imagem",
        title: corta(v.caption, 500) || null,
        views: v.videoViewCount ?? v.videoPlayCount ?? null,
        likes: v.likesCount ?? null, comments: v.commentsCount ?? null,
        posted_at: v.timestamp ? v.timestamp.slice(0, 10) : null,
        thumb: v.displayUrl ?? null,
      }));
  }

  const comLegenda = vids.filter((v) => (v.title || "").trim().length > 3).length;
  if (!vids.length) return NextResponse.json({ error: "perfil sem peças públicas com legenda", handle });

  // ── gravar: acrescentar o que falta, refrescar o que já está, apagar nunca ──
  if (force && (atuais ?? []).length) await db.from("videos").delete().eq("creator_id", c.id);
  const porChave = new Map();
  for (const v of force ? [] : (atuais ?? [])) { const k = chaveUrl(v.url); if (k && !porChave.has(k)) porChave.set(k, v); }
  const inserir = [];
  let atualizadas = 0;
  for (const v of vids) {
    const k = chaveUrl(v.url);
    const ja = k ? porChave.get(k) : null;
    if (!ja) { inserir.push(v); continue; }
    // métricas frescas na peça que já existe; transcript/analysis ficam como estão
    const patch = { views: v.views, likes: v.likes, comments: v.comments };
    if (v.shares != null) patch.shares = v.shares;
    if (v.saves != null) patch.saves = v.saves;
    if (v.thumb) patch.thumb = v.thumb;
    if (v.posted_at) patch.posted_at = v.posted_at;
    const { error } = await db.from("videos").update(patch).eq("id", ja.id);
    if (!error) atualizadas++;
  }
  if (inserir.length) {
    const { error } = await db.from("videos").insert(inserir);
    if (error) return NextResponse.json({ error: error.message.slice(0, 200), handle }, { status: 200 });
  }

  // ── snapshot do dia (opcional): as fórmulas do /api/cron/collect, sobre a mesma raspagem ──
  let snapshot = null;
  if (comSnapshot && perfil?.followers) {
    const medidos = vids.filter((v) => v.tipo === "video" && Number(v.views) > 0);
    const soma = (f) => medidos.reduce((s, v) => s + (Number(f(v)) || 0), 0);
    const views = soma((v) => v.views);
    const engRate = engRateViews(soma((v) => v.likes) + soma((v) => v.comments) + soma((v) => v.shares), views);
    const hoje = new Date().toISOString().slice(0, 10);
    // idempotente: uma segunda passagem no mesmo dia substitui, não duplica
    await db.from("snapshots").delete().eq("creator_id", c.id).eq("captured_at", hoje);
    await db.from("snapshots").insert({
      creator_id: c.id, captured_at: hoje,
      followers: perfil.followers,
      avg_views: medidos.length ? Math.round(views / medidos.length) : null,
      eng_rate: engRate,
      saves_per_1k: views ? +(soma((v) => v.saves) / views * 1000).toFixed(2) : null,
      shares_per_1k: views ? +(soma((v) => v.shares) / views * 1000).toFixed(2) : null,
    });
    await db.from("creators").update({ followers: perfil.followers, ...(perfil.avatar ? { avatar_url: perfil.avatar } : {}) }).eq("id", c.id);
    // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
    if (perfil.avatar) await guardarAvatar(db, c.id, perfil.avatar);
    snapshot = { followers: perfil.followers, eng_rate: engRate, videos_medidos: medidos.length };
  }

  // números por rede do card do briefing (creators.metricas_rede, lib/metricas-rede.js):
  // recalculados com as peças e os seguidores acabados de gravar, para a pessoa inteira.
  // Best-effort — uma falha aqui não desfaz a importação; o scripts/metricas-rede.mjs apanha.
  let metricasRede = null;
  try { metricasRede = (await atualizarMetricasRede(db, c.id)).ok; }
  catch { metricasRede = false; }

  return NextResponse.json({
    handle, plataforma: c.platform, metricas_rede: metricasRede,
    novas: inserir.length, atualizadas, ja_tinha: (atuais ?? []).length,
    total: (force ? 0 : (atuais ?? []).length) + inserir.length,
    com_legenda: comLegenda,
    videos: vids.filter((v) => v.tipo === "video").length, imagens: vids.filter((v) => v.tipo === "imagem").length,
    ...(snapshot ? { snapshot } : {}),
  });
}
