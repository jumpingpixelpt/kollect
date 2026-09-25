import { NextResponse } from "next/server";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseServer as supabase, supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { buildAudience } from "@/lib/audience";
import { engRateViews } from "@/lib/engagement";
import { podeGastar } from "@/lib/ic-budget";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://api-dashboard.influencers.club";

async function ic(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

/**
 * Promoção via influencers.club (1 crédito + 0,03 de posts):
 * GET ?tubular_id=ic_ig_xxx — enrich full c/ audiência → creator + snapshots
 * (trajetória 12m reconstruída dos 4 pontos trimestrais) + vídeos recentes →
 * dispara enrich (transcrição, marcas, kol, score).
 *
 * DESLIGADA por omissão (decisão do cliente, ago/2026 — fecho do âmbito do IC): a promoção
 * vive no Apify (/api/promote roteia por plataforma) e a Tubular dá o growth mensal, portanto
 * este caminho já não compra nada que só o IC tenha — a demografia entra pelo audience-refresh.
 * Já não tinha chamadores desde jul/2026; fica fechada no padrão do ic-sweep/ic-discover
 * porque uma rota aberta é orçamento em risco. Para reabrir conscientemente: IC_PROMOTE_ENABLED=1.
 */
const PROMOCAO_LIGADA = process.env.IC_PROMOTE_ENABLED === "1";
const DESLIGADA_MSG = "promoção via influencers.club desligada (decisão de ago/2026: o IC fica reservado ao que só ele tem — demografia via audience-refresh e shares via ic-shares). Use /api/promote?tubular_id=, que roteia por plataforma para o Apify. Para reabrir: IC_PROMOTE_ENABLED=1.";

export async function GET(req) {
  const bloqueio = await exigirSessao(req, { admin: true });
  if (bloqueio) return bloqueio;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

async function run(req) {
  if (!PROMOCAO_LIGADA) return NextResponse.json({ error: DESLIGADA_MSG, rota: "promote-ic" }, { status: 200 });
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
  const tid = new URL(req.url).searchParams.get("tubular_id");
  const db = supabaseAdmin();
  const { data: prospect } = await db.from("prospects").select("*").eq("tubular_id", tid).maybeSingle();
  if (!prospect?.handle) return NextResponse.json({ error: "prospect sem handle" }, { status: 200 });
  const trail = (s) => db.from("prospects").update({ status: s }).eq("tubular_id", tid);
  const handle = prospect.handle;
  const platform = prospect.platform === "tiktok" ? "tiktok" : "instagram";

  // ─── 1. enrich full com audiência ────────────────────────────────────────
  // Piso antes de gastar (jul/2026 — post-mortem dos créditos). Aqui, ao contrário do
  // promote-apify, a chamada paga é o caminho inteiro: sem ela não há perfil nenhum para
  // promover, portanto sem saldo aborta em vez de seguir sem demografia.
  const orc = await podeGastar(1);
  if (!orc.ok) {
    await trail("ic:sem_creditos");
    return NextResponse.json({
      error: `sem orçamento no influencers.club — ${orc.motivo}. Promova pelo Apify (/api/promote-apify?tubular_id=${tid}), que não gasta créditos do IC.`,
      saldo_ic: orc.saldo,
    }, { status: 200 });
  }
  await trail("ic:enriquecendo");
  let full;
  try { full = (await ic("/public/v1/creators/enrich/handle/full/", { handle, platform, include_audience_data: true })).result; }
  catch (e) {
    // "enrich falhou" colidia com a cadeia de /api/enrich e mandava quem lia o card
    // procurar o problema no sítio errado: isto é a API da influencers.club a recusar.
    // O 401 é o caso comum e tem uma ação concreta, por isso diz-se qual é.
    await trail(`falha_ic:${String(e).slice(0, 60)}`);
    const msg = String(e);
    const erro = /\b401\b/.test(msg)
      ? "influencers.club recusou a chave (401) — INFLUENCERS_CLUB_API_KEY inválida, expirada ou sem plano ativo"
      : "influencers.club recusou o enriquecimento do perfil";
    return NextResponse.json({ error: erro, detalhe: msg.slice(0, 250) }, { status: 200 });
  }
  const p = full?.[platform];
  if (!p?.follower_count) { await trail("ic:sem_dados"); return NextResponse.json({ error: "influencers.club sem dados desse perfil" }, { status: 200 }); }

  const followers = p.follower_count;
  // engajamento SEMPRE eng/views (decisão do cliente): a IC só expõe engagement_percent (base seguidores), que NÃO usamos.
  // Inicia com o eng/views do prospect (Tubular) e recalcula da amostra de posts da IC mais abaixo.
  let er = prospect.eng_rate ?? null;
  const nicho = [p.niche_class, p.niche_sub_class].flat().filter(Boolean).join(" · ") || "Beauty";

  // ─── 2. creator + snapshot de hoje ───────────────────────────────────────
  const { data: cid, error: ie } = await supabase.rpc("ingest_profile", {
    p_handle: handle, p_platform: platform,
    p_name: prospect.name ?? p.full_name ?? handle,
    p_avatar: p.profile_picture ?? prospect.thumbnail ?? null,
    p_bio: p.biography ?? null,
    p_followers: followers, p_avg_views: null, p_eng: er,
    p_niche: nicho.slice(0, 80), p_category: /cabelo|hair/i.test(nicho) ? "cabelo" : /skin|pele/i.test(nicho) ? "skincare" : "make",
    p_tubular_id: tid,
  });
  if (ie) { await trail(`falha_ingest:${ie.message.slice(0, 60)}`); return NextResponse.json({ error: ie.message }, { status: 200 }); }
  // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
  await guardarAvatar(db, cid, p.profile_picture ?? prospect.thumbnail ?? null);

  // demografia da audiência (critério 10 do cliente)
  const aud = p.audience?.audience_followers;
  if (aud) {
    const fem = (aud.audience_genders ?? []).find((g) => g.code === "FEMALE")?.weight ?? null;
    const faixa = (aud.audience_ages ?? []).filter((a) => ["18-24", "25-34", "35-44"].includes(a.code)).reduce((s, a) => s + a.weight, 0);
    const br = (aud.audience_geo?.countries ?? []).find((c) => c.code === "BR")?.weight ?? null;
    await db.from("creators").update({
      audience: buildAudience(aud),
    }).eq("id", cid);
  }

  // ─── 3. trajetória: snapshots trimestrais dos growth points ─────────────
  const g = p.creator_follower_growth;
  if (g && typeof g === "object") {
    const pontos = [["3_months_ago", 90], ["6_months_ago", 180], ["9_months_ago", 270], ["12_months_ago", 365]];
    const snaps = [];
    for (const [k, dias] of pontos) {
      const pct = Number(g[k]);
      if (!Number.isFinite(pct) || pct <= -99) continue;
      snaps.push({
        creator_id: cid,
        captured_at: new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10),
        followers: Math.round(followers / (1 + pct / 100)),
        avg_views: null, eng_rate: er,
      });
    }
    if (snaps.length) await db.from("snapshots").upsert(snaps, { onConflict: "creator_id,captured_at", ignoreDuplicates: true }).then(() => {}, () => {});
  }

  // ─── 4. posts recentes (0,03 crédito) ────────────────────────────────────
  let nVids = 0, postsErr = null;
  try {
    // pagina pra trás (~4 páginas ≈ 48 posts) pra dar profundidade ao histórico de marcas
    const list = [];
    let token = null;
    for (let pg = 0; pg < 4; pg++) {
      const body = { handle, platform };
      if (token) body.next_token = token;
      const posts = await ic("/public/v1/creators/content/posts/", body);
      const items = posts.result?.items ?? [];
      list.push(...items);
      token = posts.result?.next_token ?? null;
      if (!token || !posts.result?.more_available || items.length === 0) break;
    }
    const vids = list
      .filter((v) => !v.user?.username || v.user.username === handle) // só posts da própria creator
      .slice(0, 48)
      .map((v) => ({
        creator_id: cid,
        url: v.url ?? null,
        title: (v.caption ?? "").slice(0, 500) || null,
        views: v.engagement?.views ?? null,
        likes: v.engagement?.likes ?? null,
        comments: v.engagement?.comments ?? null,
        posted_at: v.taken_at ? new Date(v.taken_at * 1000).toISOString().slice(0, 10) : null,
      })).filter((v) => v.url || v.title);
    if (vids.length) {
      await db.from("videos").delete().eq("creator_id", cid);
      const { error } = await db.from("videos").insert(vids);
      if (!error) nVids = vids.length;
    }
    // engajamento SEMPRE eng/views: recalcula da amostra de posts da IC e corrige o snapshot de hoje
    const totV = vids.reduce((sm, v) => sm + (Number(v.views) || 0), 0);
    const totE = vids.reduce((sm, v) => sm + ((Number(v.likes) || 0) + (Number(v.comments) || 0)), 0);
    const erViews = engRateViews(totE, totV);
    if (erViews != null) {
      er = erViews;
      await db.from("snapshots").update({ eng_rate: erViews })
        .eq("creator_id", cid).eq("captured_at", new Date().toISOString().slice(0, 10))
        .then(() => {}, () => {});
    }
  } catch (e) { postsErr = String(e).slice(0, 150); }

  await trail("promovido");

  // ─── 5. enrich: light (só marcas + kol p/ demo/briefing-match) ou full (dossiê em background) ─
  const base = new URL(req.url).origin;
  const light = new URL(req.url).searchParams.get("light");
  if (light) {
    await fetch(`${base}/api/brand-scan?handle=${encodeURIComponent(handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(90000) }).then((r) => r.json()).catch(() => {});
    await fetch(`${base}/api/kol-screen?handle=${encodeURIComponent(handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch(() => {});
  } else {
    fetch(`${base}/api/enrich?handle=${handle}`, { headers: internalHeaders(), signal: AbortSignal.timeout(1500) }).catch(() => {});
  }

  return NextResponse.json({
    ok: true, fonte: "influencers_club", creator_id: cid, handle, plataforma: platform,
    seguidores: followers, eng_rate: er, nicho,
    snapshots_trajetoria: g ? Object.keys(g).length : 0, videos: nVids, posts_err: postsErr,
    demografia: aud ? "coletada" : "indisponível",
    dossie: "completando em background (~3 min): transcrições, marcas, screening e score",
  });
}
