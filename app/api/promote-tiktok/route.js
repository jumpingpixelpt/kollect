import { NextResponse } from "next/server";
import { ligarMesmaPessoa } from "@/lib/pessoa";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { engRateViews } from "@/lib/engagement";
import { categoriaPorTexto, textoParaCategoria } from "@/lib/categoria";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Promoção de creator do TikTok via Apify (clockworks) — ZERO Influencer Club.
 * Perfil + posts (clockworks) → ingest_profile → vídeos → brand-scan + kol-screen.
 * GET ?tubular_id=caption-tk:handle  ou  ?handle=xxx
 */
async function apify(actor, input, timeout = 150) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);

export async function GET(req) {
  const bloqueio = await exigirSessao(req, { admin: true });
  if (bloqueio) return bloqueio;
  try {
    if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
    const sp = new URL(req.url).searchParams;
    const tid = sp.get("tubular_id");
    let handle = sp.get("handle");
    const db = supabaseAdmin();

    let prospect = null;
    if (tid) { const { data } = await db.from("prospects").select("*").eq("tubular_id", tid).maybeSingle(); prospect = data; handle = handle || prospect?.handle; }
    if (!handle) return NextResponse.json({ error: "handle ou tubular_id obrigatório" }, { status: 200 });
    handle = handle.replace(/^@/, "");
    const trail = (s) => tid ? db.from("prospects").update({ status: s }).eq("tubular_id", tid) : Promise.resolve();
    // os erros escrevem o URL do perfil na mensagem (pedido do operador, jul/2026): é o que
    // permite conferir com um clique em vez de reconstruir o link à mão a partir do @
    const urlPerfil = `https://www.tiktok.com/@${handle}`;

    await trail(`apify-tk:perfil:@${handle}`);
    let items;
    try { items = await apify("clockworks~tiktok-scraper", { profiles: [handle], resultsPerPage: 15, shouldDownloadVideos: false, shouldDownloadCovers: false }, 150); }
    catch (e) { await trail(`falha_tk:${String(e).slice(0, 60)}`); return NextResponse.json({ error: `perfil TikTok falhou no Apify — ${urlPerfil}`, detalhe: String(e).slice(0, 200) }, { status: 200 }); }
    // Recuo pelo POST quando o perfil não abre (03/ago/2026). O TikTok tem perfis com
    // "controlos de audiência": a página do @ exige sessão e o actor volta vazio, mas os
    // vídeos continuam públicos e servem o mesmo dado — @tainaraqquel (135k, queda capilar)
    // era isso, e a mensagem antiga acusava-a de "privada ou @ errado", que é falso. O
    // prospect traz o URL do post que o descobriu; se o perfil não abre, pergunta-se ao post.
    if (!items.length && prospect?.post_url) {
      const vid = String(prospect.post_url).match(/video\/(\d{10,})/)?.[1];
      if (vid) {
        await trail(`apify-tk:por_post:${vid}`);
        try {
          items = await apify("clockworks~tiktok-scraper", {
            postURLs: [`https://www.tiktok.com/@${handle}/video/${vid}`],
            resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: false,
          }, 150);
        } catch { /* segue para a mensagem de erro abaixo */ }
      }
    }
    if (!items.length) { await trail("apify-tk:vazio"); return NextResponse.json({ error: `sem posts/perfil no TikTok (perfil com controlos de audiência, privado ou @ errado) — ${urlPerfil}` }, { status: 200 }); }

    const am = items.find((it) => it.authorMeta)?.authorMeta || {};
    const followers = am.fans ?? am.followers ?? null;
    if (!followers) { await trail("apify-tk:sem_seguidores"); return NextResponse.json({ error: `perfil sem contagem de seguidores — ${urlPerfil}` }, { status: 200 }); }

    const views = items.map((v) => Number(v.playCount) || 0).filter(Boolean);
    const avgViews = views.length ? Math.round(sum(views) / views.length) : null;
    const eng = sum(items.map((v) => (Number(v.diggCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0)));
    const engRate = engRateViews(eng, sum(views)) ?? prospect?.eng_rate ?? null;

    const { data: cid, error: ie } = await db.rpc("ingest_profile", {
      p_handle: handle, p_platform: "tiktok",
      p_name: prospect?.name || am.nickName || handle,
      p_avatar: am.avatar ?? null, p_bio: am.signature ?? null,
      p_followers: followers, p_avg_views: avgViews, p_eng: engRate,
      // ver a nota em lib/categoria.js: escrevia-se sempre "cabelo", constante que a RPC
      // propaga com coalesce e que apagava a categoria boa a cada re-promoção. Null quando
      // o texto não dá sinal — preserva em vez de inventar.
      p_niche: prospect?.genre || null,
      p_category: categoriaPorTexto(textoParaCategoria(am.signature, items.map((v) => v.text || v.desc))),
      p_tubular_id: tid || `apify-tk:${handle}`,
    });
    if (ie) { await trail(`falha_ingest:${ie.message.slice(0, 60)}`); return NextResponse.json({ error: ie.message }, { status: 200 }); }
    // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
    await guardarAvatar(db, cid, am.avatar ?? null);
    // a mesma pessoa noutra rede? (bio idêntica ou @ idêntico) — cartão único, ficha com as duas
    await ligarMesmaPessoa(db, { id: cid, handle, platform: "tiktok", bio: am.signature ?? null, tubular_id: tid || null });

    const vids = items
      .filter((v) => v.playCount != null || v.webVideoUrl)
      .map((v) => ({
        creator_id: cid, url: v.webVideoUrl ?? null,
        title: (v.text ?? "").slice(0, 500) || null,
        views: Number(v.playCount) || null, likes: Number(v.diggCount) || null, comments: Number(v.commentCount) || null,
        posted_at: v.createTimeISO ? v.createTimeISO.slice(0, 10) : null,
        thumb: v.videoMeta?.coverUrl ?? v.covers?.default ?? v.covers?.origin ?? null,
      }));
    if (vids.length) { await db.from("videos").delete().eq("creator_id", cid); await db.from("videos").insert(vids); }

    if (prospect?.growth_30 != null && prospect.growth_30 !== 0) {
      const back = Math.round(followers / (1 + prospect.growth_30 / 100));
      const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      await db.from("snapshots").upsert({ creator_id: cid, captured_at: d30, followers: back, avg_views: avgViews, eng_rate: engRate }, { onConflict: "creator_id,captured_at", ignoreDuplicates: true }).then(() => {}, () => {});
    }

    await trail("promovido");

    const base = new URL(req.url).origin;

    // ?enrich=1 (importação em lote, 11/09/2026): a cadeia completa corre AQUI, como no
    // promote-apify, e não no chamador — a invocação do cron pode morrer aos 300 s antes de a
    // pedir, e o creator ficava `promovido` sem Score KOL, invisível ao drain do deep-scan.
    // O enrich já faz brand-scan e kol-screen; correr o par inline antes seria pagar o
    // Sonnet do brand-scan duas vezes. ?sem_conteudo=1 passa ?conteudo=0 ao enrich.
    if (sp.get("enrich") === "1") {
      const conteudo = sp.get("sem_conteudo") === "1" ? "&conteudo=0" : "";
      let enrich = null;
      try {
        const r = await fetch(`${base}/api/enrich?handle=${encodeURIComponent(handle)}${conteudo}`, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(200000) });
        enrich = await r.json().catch(() => null);
      } catch { enrich = { aviso: "enrich segue rodando em background" }; }
      return NextResponse.json({ ok: true, fonte: "apify-tiktok", creator_id: cid, handle, seguidores: followers, posts: vids.length, eng_rate: engRate, enrich });
    }

    // classificação inline (sem IC): brand-scan (legenda→sub-nicho) + kol-screen (classe)
    let scan = null, screen = null;
    try { scan = await fetch(`${base}/api/brand-scan?handle=${encodeURIComponent(handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(90000) }).then((r) => r.json()).catch(() => null); } catch {}
    try { screen = await fetch(`${base}/api/kol-screen?handle=${encodeURIComponent(handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch(() => null); } catch {}

    return NextResponse.json({ ok: true, fonte: "apify-tiktok", creator_id: cid, handle, seguidores: followers, posts: vids.length, eng_rate: engRate, classe: screen?.kol_screen?.classe ?? screen?.classe ?? null, sub_nichos: scan?.sub_nichos ?? null });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
