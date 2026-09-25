import { NextResponse } from "next/server";
import { ligarMesmaPessoa } from "@/lib/pessoa";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseServer as supabase, supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { engRateViews } from "@/lib/engagement";
import { podeGastar } from "@/lib/ic-budget";
import { categoriaPorTexto, textoParaCategoria } from "@/lib/categoria";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Caminho B de promoção (cota Tubular esgotada): promove um prospect via Apify.
 * GET ?tubular_id=X [&handle=Y pra pular a resolução de @]
 *  1. resolve o @ buscando o nome no Instagram (apify instagram-search-scraper)
 *  2. puxa perfil + últimos posts (apify instagram-profile-scraper)
 *  3. ingest_profile + vídeos no banco + snapshot retroativo do growth conhecido
 *  4. dispara o enrich (etapas Tubular falham de leve; o resto roda)
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req, { admin: true });
  if (bloqueio) return bloqueio;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

async function apify(actor, input, timeout = 180) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

async function run(req) {
  if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const tid = sp.get("tubular_id");
  let handle = sp.get("handle");
  const db = supabaseAdmin();

  const { data: prospect } = await db.from("prospects").select("*").eq("tubular_id", tid).maybeSingle();
  if (!prospect) return NextResponse.json({ error: "prospect não encontrado" }, { status: 200 });
  const trail = async (s) => db.from("prospects").update({ status: s }).eq("tubular_id", tid);

  // ── 1. resolver o @ pelo nome ────────────────────────────────────────────
  let debugSearch = null;
  if (!handle) {
    await trail("apify:buscando_handle");
    const alvo = norm(prospect.name);
    const partes = (prospect.name || "").split(/[|•·–]/).map((s) => s.trim()).filter(Boolean);
    const termos = [...new Set([norm(prospect.name), ...partes.map(norm)])].filter((t) => t.length > 2).slice(0, 3);
    const users = [];
    let erroBusca = null;
    for (const termo of termos) {
      try {
        const items = await apify("apify~instagram-search-scraper", { search: termo, searchType: "user", searchLimit: 10 }, 120);
        users.push(...items.flatMap((i) => i.users ?? (i.username ? [i] : [])));
      } catch (e) { erroBusca = String(e).slice(0, 150); }
    }

    const alvoTokens = new Set(alvo.split(" ").filter((t) => t.length > 2));
    let best = null, bestScore = 0;
    for (const u of users) {
      const cand = norm(`${u.fullName || ""} ${u.username || ""}`);
      let hits = 0;
      for (const t of alvoTokens) if (cand.includes(t)) hits++;
      const score = alvoTokens.size ? hits / alvoTokens.size : 0;
      if (score > bestScore) { bestScore = score; best = u; }
    }
    debugSearch = { termos, total_candidatos: users.length, candidatos: users.slice(0, 10).map((u) => ({ username: u.username, fullName: u.fullName })), escolhido: best?.username, confianca: Math.round(bestScore * 100), erroBusca };
    await db.from("sweep_state").upsert({ key: `debug_promote_${tid}`, value: debugSearch, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (!best || bestScore < 0.5) { await trail("apify:handle_nao_resolvido"); return NextResponse.json({ error: "não achei um @ confiável pro nome", ...debugSearch }, { status: 200 }); }
    handle = best.username;
  }

  // ── 2. perfil + posts ────────────────────────────────────────────────────
  await trail(`apify:perfil:@${handle}`);
  // os erros escrevem o URL do perfil na mensagem (pedido do operador, jul/2026): é o que
  // permite conferir com um clique em vez de reconstruir o link à mão a partir do @
  const urlPerfil = `https://www.instagram.com/${handle}/`;
  let p;
  try {
    const items = await apify("apify~instagram-profile-scraper", { usernames: [handle] }, 180);
    p = items[0];
  } catch (e) { await trail(`falha_perfil:${String(e).slice(0, 60)}`); return NextResponse.json({ error: `perfil falhou no Apify — ${urlPerfil}`, detalhe: String(e).slice(0, 200), debugSearch }, { status: 200 }); }
  if (!p?.followersCount) { await trail("apify:perfil_vazio"); return NextResponse.json({ error: `perfil sem dados (privado?) — ${urlPerfil}`, debugSearch }, { status: 200 }); }

  // sanidade: seguidores do achado vs do prospect (Tubular)
  const ratio = prospect.followers ? p.followersCount / prospect.followers : 1;
  const suspeito = ratio < 0.25 || ratio > 4;
  // divergência extrema = quase certeza de homônima errada → BLOQUEIA
  if (prospect.followers && (ratio < 0.1 || ratio > 10)) {
    await trail("apify:homonima_suspeita");
    return NextResponse.json({
      error: `provável homônima: ${urlPerfil} tem ${p.followersCount} seguidores, mas o prospect "${prospect.name || prospect.handle || tid}" tem ${prospect.followers}. Promoção bloqueada — confira o perfil no link; se for outra pessoa, cole o link do perfil verdadeiro na barra "Avaliar perfil" da home.`,
      debugSearch,
    }, { status: 200 });
  }

  const posts = (p.latestPosts || []).slice(0, 12);
  const views = posts.map((v) => v.videoViewCount ?? v.videoPlayCount ?? 0).filter(Boolean);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avgViews = views.length ? Math.round(sum(views) / views.length) : null;
  const likes = sum(posts.map((v) => v.likesCount ?? 0));
  const comments = sum(posts.map((v) => v.commentsCount ?? 0));
  const engRate = engRateViews(likes + comments, sum(views)) ?? prospect.eng_rate; // SEMPRE eng/views (fallback prospect = Tubular, já eng/views)

  // ── 3. criar creator + snapshot + vídeos ────────────────────────────────
  const { data: cid, error: ie } = await supabase.rpc("ingest_profile", {
    p_handle: handle, p_platform: "instagram",
    p_name: prospect.name ?? p.fullName ?? handle,
    p_avatar: p.profilePicUrlHD ?? p.profilePicUrl ?? null,
    p_bio: p.biography ?? null,
    p_followers: p.followersCount, p_avg_views: avgViews, p_eng: engRate,
    // Categoria MEDIDA do texto do perfil, não constante. Escrevia-se sempre "skincare",
    // que a RPC propaga com coalesce e portanto SOBRESCREVIA a categoria correcta que o
    // tubular-sync tinha derivado da taxonomy. Sem sinal no texto vai null, que é o que a
    // RPC entende por "não sei" e preserva o que lá estiver — ver lib/categoria.js.
    p_niche: prospect?.genre || null,
    p_category: categoriaPorTexto(textoParaCategoria(p.biography, posts.map((v) => v.caption || v.text))),
    p_tubular_id: tid,
  });
  if (ie) { await trail(`falha_ingest:${ie.message.slice(0, 60)}`); return NextResponse.json({ error: ie.message, debugSearch }, { status: 200 }); }
  // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
  await guardarAvatar(db, cid, p.profilePicUrlHD ?? p.profilePicUrl ?? null);
  // a mesma pessoa noutra rede? (bio idêntica ou @ idêntico) — cartão único, ficha com as duas
  await ligarMesmaPessoa(supabase, { id: cid, handle, platform: "instagram", bio: p.biography ?? null, tubular_id: tid || null });

  // Complemento influencers.club: growth trimestral + demografia (1 CRÉDITO por promoção).
  // Fica — a demografia de audiência é o único dado que só o IC tem, e é dela que saem a
  // autoridade e a aderência do Score KOL (30% do peso). O que mudou (jul/2026, post-mortem
  // dos créditos) é que deixou de disparar às cegas: antes o único gate era a existência da
  // chave, que existe sempre em produção, portanto toda promoção gastava. Agora passa pelo
  // piso de lib/ic-budget.js. Sem saldo, a promoção conclui à mesma sem demografia — o
  // creator nasce com `audience` nulo e o audience-refresh apanha-o quando houver orçamento.
  // Idempotência do crédito (02/ago/2026): a re-promoção passou a ser o caminho sancionado
  // para re-importar vídeos de perfis com URLs mortos, e sem este guard cada re-promoção
  // recomprava uma demografia que o IC já vendeu — 1 crédito para receber o que já está na
  // coluna. O crédito só muda a resposta quando `audience` está vazio.
  const { data: cAud } = await db.from("creators").select("audience").eq("id", cid).single();
  const audienceJaExiste = cAud?.audience && Object.keys(cAud.audience).length > 0;
  // Em lote (sem_conteudo=1) a compra inline salta: a cadeia corre o audience-refresh, que
  // grava o formato v2 — a compra daqui grava sem `v`, o audience-refresh não a reconhece e
  // voltava a comprar (2 créditos por promoção). Ver app/api/audience-refresh/route.js.
  const emLote = sp.get("sem_conteudo") === "1";
  const orcAud = audienceJaExiste
    ? { ok: false, motivo: "audience já existe — crédito poupado" }
    : emLote ? { ok: false, motivo: "lote: audiência pelo audience-refresh da cadeia" }
    : process.env.INFLUENCERS_CLUB_API_KEY ? await podeGastar(1) : { ok: false, motivo: "sem chave IC" };
  if (!orcAud.ok) await trail(`ic:audiencia_saltada:${String(orcAud.motivo).slice(0, 50)}`);
  if (orcAud.ok) {
    try {
      const icr = await fetch("https://api-dashboard.influencers.club/public/v1/creators/enrich/handle/full/", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ handle, platform: "instagram", include_audience_data: true }),
        signal: AbortSignal.timeout(60000),
      }).then((r) => r.json());
      const icp = icr?.result?.instagram;
      const g = icp?.creator_follower_growth;
      if (g && typeof g === "object") {
        const snaps = [];
        for (const [k, dias] of [["3_months_ago", 90], ["6_months_ago", 180], ["9_months_ago", 270], ["12_months_ago", 365]]) {
          const pct = Number(g[k]);
          if (!Number.isFinite(pct) || pct <= -99) continue;
          snaps.push({ creator_id: cid, captured_at: new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10), followers: Math.round(p.followersCount / (1 + pct / 100)), avg_views: null, eng_rate: null });
        }
        if (snaps.length) await db.from("snapshots").upsert(snaps, { onConflict: "creator_id,captured_at", ignoreDuplicates: true }).then(() => {}, () => {});
      }
      const aud = icp?.audience?.audience_followers;
      if (aud) {
        const fem = (aud.audience_genders ?? []).find((x) => x.code === "FEMALE")?.weight ?? null;
        const faixa = (aud.audience_ages ?? []).filter((a) => ["18-24", "25-34", "35-44"].includes(a.code)).reduce((sm, a) => sm + a.weight, 0);
        const br = (aud.audience_geo?.countries ?? []).find((x) => x.code === "BR")?.weight ?? null;
        await db.from("creators").update({ audience: { fonte: "influencers_club", coletado_em: new Date().toISOString().slice(0, 10), mulheres_pct: fem != null ? Math.round(fem * 1000) / 10 : null, faixa_18_45_pct: Math.round(faixa * 1000) / 10, brasil_pct: br != null ? Math.round(br * 1000) / 10 : null, idades: aud.audience_ages ?? null, generos: aud.audience_genders ?? null } }).eq("id", cid);
      }
    } catch { /* complemento opcional — segue sem */ }
  }

  // snapshot retroativo (30d atrás) com o growth real medido pela Tubular antes da cota
  if (prospect.growth_30 != null && prospect.growth_30 !== 0) {
    const back = Math.round(p.followersCount / (1 + prospect.growth_30 / 100));
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    await db.from("snapshots").upsert(
      { creator_id: cid, captured_at: d30, followers: back, avg_views: avgViews, eng_rate: engRate },
      { onConflict: "creator_id,captured_at", ignoreDuplicates: true }
    ).then(() => {}, () => {});
  }

  const vids = posts
    .filter((v) => v.type === "Video" || v.videoViewCount != null || v.videoPlayCount != null || /\/reel\//.test(v.url || ""))
    .map((v) => ({
      creator_id: cid,
      url: v.url ?? null,
      title: (v.caption ?? "").slice(0, 500) || null,
      views: v.videoViewCount ?? v.videoPlayCount ?? null,
      likes: v.likesCount ?? null,
      comments: v.commentsCount ?? null,
      posted_at: v.timestamp ? v.timestamp.slice(0, 10) : null,
      thumb: v.displayUrl ?? null,
    }));
  if (vids.length) {
    await db.from("videos").delete().eq("creator_id", cid);
    await db.from("videos").insert(vids);
  }

  await trail("promovido");

  // ── 4. enrich (tubular falha de leve; brand-scan/deep-scan/kol/score rodam) ─
  const base = new URL(req.url).origin;
  let enrich = null;
  try {
    // sem_conteudo=1 (importação em lote): a cadeia corre sem deep-scan — ver /api/enrich.
    const conteudo = sp.get("sem_conteudo") === "1" ? "&conteudo=0" : "";
    const r = await fetch(`${base}/api/enrich?handle=${encodeURIComponent(handle)}${conteudo}`, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(200000) });
    enrich = await r.json().catch(() => null);
  } catch { enrich = { aviso: "enrich segue rodando em background" }; }

  return NextResponse.json({
    ok: true, fonte: "apify", creator_id: cid, handle, plataforma: "instagram",
    seguidores: p.followersCount, posts_ingeridos: vids.length, eng_rate: engRate,
    sanidade: suspeito ? `ATENÇÃO: seguidores ${p.followersCount} vs ${prospect.followers} do prospect — confirmar identidade` : "ok",
    debugSearch, enrich,
  });
}
