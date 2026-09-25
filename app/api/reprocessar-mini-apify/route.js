import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { funnelMiniScore } from "@/lib/score";
import { engRateViews } from "@/lib/engagement";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Passo 3 do reprocessamento do mini-score — para os prospects PARTIDOS que NÃO
 * têm tubular_id (fontes csv-liso / caption-* / xlsx-elseve). São ~184, todos com
 * handle + plataforma mas sem followers/eng, logo sem mini_score útil.
 *
 * Vive como rota (e não como script local) por uma razão concreta: raspar perfis
 * precisa do APIFY_TOKEN, que é uma env var SENSITIVE da Vercel — não sai do
 * dashboard nem se corre localmente. Aqui usa-se o token do ambiente sem o expor.
 *
 * NÃO promove ninguém a creator (isso é o promote-*). Só preenche a linha de
 * descoberta: followers, eng_rate, mini_score, status. Como preencher followers
 * tira a linha da própria query de candidatos, a rota é naturalmente DRENÁVEL —
 * chama-se várias vezes até `restantes` chegar a 0.
 *
 * Eficiência: os atores do Apify aceitam arrays, por isso um lote é 1 chamada por
 * plataforma (todos os @ de IG juntos, todos os de TikTok juntos), não 1 por perfil.
 *
 * GET ?limit=N  (default 60 — cabe no tecto de 300s; baixa se o TikTok demorar)
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const lc = (s) => (s || "").toLowerCase();

async function apify(actor, input, timeout = 240) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return Array.isArray(j) ? j : [];
}

async function run(req) {
  if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado neste ambiente" }, { status: 200 });
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 60, 120);
  const db = supabaseAdmin();

  // candidatos: partidos, sem tubular_id, com handle+plataforma, ainda não tratados
  const { data: alvos, error } = await db
    .from("prospects")
    .select("tubular_id, handle, platform, name, fonte")
    .is("followers", null)
    .not("handle", "is", null)
    .neq("fonte", "tubular")
    .in("platform", ["instagram", "tiktok"])
    .neq("status", "promovido")
    .order("fonte")
    .limit(limit);
  if (error) return NextResponse.json({ error: `query prospects: ${error.message}` }, { status: 200 });
  if (!alvos?.length) return NextResponse.json({ ok: true, processados: 0, restantes: 0, nota: "nada partido para tratar" }, { status: 200 });

  // total ainda por tratar (para o caller saber quando parar de drenar)
  const { count: restantesAntes } = await db
    .from("prospects").select("tubular_id", { count: "exact", head: true })
    .is("followers", null).not("handle", "is", null).neq("fonte", "tubular")
    .in("platform", ["instagram", "tiktok"]).neq("status", "promovido");

  const igs = alvos.filter((p) => p.platform === "instagram");
  const tks = alvos.filter((p) => p.platform === "tiktok");

  // ── scrape em lote, 1 chamada por plataforma ──────────────────────────────
  const stats = new Map(); // handle-lc -> { followers, eng }
  let erroApify = null;

  if (igs.length) {
    try {
      const items = await apify("apify~instagram-profile-scraper", { usernames: igs.map((p) => p.handle) }, 240);
      for (const p of items) {
        if (!p?.username || !p?.followersCount) continue;
        const posts = (p.latestPosts || []).slice(0, 12);
        const views = posts.map((v) => v.videoViewCount ?? v.videoPlayCount ?? 0).filter(Boolean);
        const likes = sum(posts.map((v) => v.likesCount ?? 0));
        const comments = sum(posts.map((v) => v.commentsCount ?? 0));
        stats.set(lc(p.username), { followers: p.followersCount, eng: engRateViews(likes + comments, sum(views)) });
      }
    } catch (e) { erroApify = `IG: ${String(e).slice(0, 150)}`; }
  }

  if (tks.length) {
    try {
      const items = await apify("clockworks~tiktok-scraper",
        { profiles: tks.map((p) => p.handle), resultsPerPage: 12, shouldDownloadVideos: false, shouldDownloadCovers: false }, 240);
      // agrupa vídeos por autor
      const porAutor = new Map();
      for (const v of items) {
        const h = lc(v.authorMeta?.name || v.authorMeta?.uniqueId || v["authorMeta.name"]);
        if (!h) continue;
        (porAutor.get(h) || porAutor.set(h, []).get(h)).push(v);
      }
      for (const [h, vids] of porAutor) {
        const followers = vids[0]?.authorMeta?.fans ?? vids[0]?.authorMeta?.followers ?? null;
        if (!followers) continue;
        const views = vids.map((v) => Number(v.playCount) || 0).filter(Boolean);
        const eng = sum(vids.map((v) => (Number(v.diggCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0)));
        stats.set(h, { followers, eng: engRateViews(eng, sum(views)) });
      }
    } catch (e) { erroApify = `${erroApify ? erroApify + " · " : ""}TT: ${String(e).slice(0, 150)}`; }
  }

  // ── gravar ────────────────────────────────────────────────────────────────
  let ok = 0, vazios = 0;
  const amostra = [];
  for (const p of alvos) {
    const s = stats.get(lc(p.handle));
    if (!s?.followers) {
      vazios++;
      await db.from("prospects").update({ status: `${p.platform}:apify_vazio` }).eq("tubular_id", p.tubular_id);
      continue;
    }
    const mini = funnelMiniScore({ engPct: s.eng ?? 0, followers: s.followers, growthPct: null });
    await db.from("prospects").update({
      followers: s.followers, eng_rate: s.eng, mini_score: mini, status: `${p.platform}:apify_reprocessado`,
    }).eq("tubular_id", p.tubular_id);
    ok++;
    if (amostra.length < 6) amostra.push({ handle: p.handle, plat: p.platform, followers: s.followers, eng: s.eng, mini });
  }

  return NextResponse.json({
    ok: true,
    processados: alvos.length, gravados: ok, vazios,
    restantes: Math.max((restantesAntes ?? alvos.length) - alvos.length, 0),
    erroApify, amostra,
  }, { status: 200 });
}
