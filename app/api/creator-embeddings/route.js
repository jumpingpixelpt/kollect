import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx (reindexa esse creator) ou ?n=10 (drain: creators sem chunks) —
 * indexação semântica do CONTEÚDO COMPLETO do creator em creator_chunks (pgvector):
 * perfil, radar score, kol screen, histórico de marcas, brand fit, audiência,
 * exec brief, hire plan e trajetória. Junto com video_chunks, alimenta o chat
 * do creator (match_creator_content) e a busca semântica global (filter=null).
 * Disparada no fim do enrich e do all-in do casting; idempotente (delete+insert).
 */
const EMB_MODEL = "gemini-embedding-001";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const DIMS = 768;

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "creator-embeddings", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

const j = (arr, sep = ", ") => (arr || []).filter(Boolean).join(sep);
const trunc = (s, n) => (s == null ? "" : String(s).slice(0, n));

function buildChunks(c, fits, snaps, videos) {
  const head = `Creator: ${c.name || c.handle} (@${c.handle}, ${c.platform}).`;
  const ks = c.kol_screen || {};
  const bhx = c.brand_history || {};
  const eb = c.exec_brief || {};
  const hp = c.hire_plan || {};
  const chunks = [];

  chunks.push({
    chunk_type: "perfil",
    content: `${head} Nicho: ${c.niche || "?"}. Bio: ${trunc(c.bio, 300)}. Seguidores: ${c.followers ?? "?"}. Crescimento 30d: ${c.growth_30d ?? "?"}%. Classe KOL: ${ks.classe_label || ks.classe || "?"}. Cachê por vídeo: ${c.cache_per_video ?? "não definido"}.`,
  });

  if (c.total != null)
    chunks.push({
      chunk_type: "radar_score",
      content: `${head} Radar Score: ${c.total}/100 — Momentum ${c.momentum ?? "?"}/30, Tração de Audiência ${c.gravity ?? "?"}/30, Autoridade & Foco ${c.authority ?? "?"}/25, Janela de Cachê ${c.window_bonus ?? "?"}/10. Janela aberta: ${c.janela_aberta ? "sim (score ≥75 e <100k seguidores)" : "não"}.`,
    });

  if (ks.classe || ks.veredicto || ks.comercial?.length) {
    const com = (ks.comercial || []).map((x) => `${x.nome}: ${x.resultado} (${trunc(x.detalhe, 90)})`);
    chunks.push({
      chunk_type: "kol_screen",
      content: `${head} KOL Screening — classe ${ks.classe_label || ks.classe || "?"} (percentil ${ks.metricas?.percentil ?? "?"}). ${trunc(ks.veredicto || ks.justificativa, 500)} Saúde comercial: ${j(com, " | ")}.`,
    });
  }

  if (bhx.marcas?.length || bhx.nichos?.length) {
    const marcas = (bhx.marcas || []).slice(0, 12).map((m) => `${m.marca} (${m.tipo}, ${m.videos ?? "?"} vídeos, ${m.views_total ?? "?"} views${m.evidencia ? `, "${trunc(m.evidencia, 70)}"` : ""})`);
    const nichos = (bhx.nichos || []).map((n) => `${n.nicho} ${n.pct}%`);
    chunks.push({
      chunk_type: "brand_history",
      content: `${head} Histórico de marcas: ${j(marcas, " | ") || "nenhuma"}. Territórios: ${j(nichos)}. Sub-nichos: ${j((bhx.sub_nichos || []).map((s) => typeof s === "string" ? s : s?.nome))}. Formatos: ${j((bhx.formatos || []).map((f) => typeof f === "string" ? f : f?.nome))}. ${trunc(bhx.resumo, 400)} Brand engagement: ${bhx.brand_engagement?.leitura || bhx.brand_engagement?.delta_pct != null ? `${bhx.brand_engagement.delta_pct}% vs orgânico` : "?"}.`,
    });
  }

  if (fits?.length)
    chunks.push({
      chunk_type: "brand_fit",
      content: `${head} Brand fit por marca: ${fits.map((f) => `${f.brands?.name}: ${f.fit_score}/100 — ${trunc(f.rationale, 220)}`).join(" | ")}`,
    });

  if (c.audience && Object.keys(c.audience).length)
    chunks.push({ chunk_type: "audience", content: `${head} Audiência: ${trunc(JSON.stringify(c.audience), 1400)}` });

  if (eb.headline || eb.recommended_role)
    chunks.push({
      chunk_type: "exec_brief",
      content: `${head} Executive brief: ${trunc(eb.headline, 300)} Papel recomendado: ${eb.recommended_role || "?"}. Best use: ${trunc(eb.best_use, 200)}. Best fit: ${j(eb.best_fit)}. Não ideal para: ${trunc(eb.not_ideal_for, 200)}. Por que entra: ${j((eb.why_she_enters || []).map((w) => trunc(typeof w === "string" ? w : w?.texto || JSON.stringify(w), 160)), " | ")}. Watchouts: ${j((eb.watchouts || []).map((w) => trunc(w, 140)), " | ")}.`,
    });

  if (hp.sintese || hp.recs?.length)
    chunks.push({ chunk_type: "hire_plan", content: `${head} Plano de contratação: ${trunc(hp.sintese, 500)} ${trunc(JSON.stringify(hp.recs || hp.modalidade || ""), 900)}` });

  if (snaps?.length > 1) {
    const first = snaps[0], last = snaps.at(-1);
    chunks.push({
      chunk_type: "trajetoria",
      content: `${head} Trajetória: ${first.followers} → ${last.followers} seguidores entre ${first.captured_at} e ${last.captured_at} (${snaps.length} medições). Taxa de engajamento atual: ${last.eng_rate ?? "?"}%. Views médias: ${last.avg_views ?? "?"}.`,
    });
  }

  if (videos?.length) {
    const vs = videos.slice(0, 12).map((v) => `"${trunc(v.title, 60)}" (${v.views ?? "?"} views${v.analysis?.viral_score?.total ? `, viral ${v.analysis.viral_score.total}/100` : ""}${v.content_score != null ? `, conteúdo ${v.content_score}/10` : ""})`);
    chunks.push({ chunk_type: "videos_resumo", content: `${head} Vídeos no radar: ${vs.join(" | ")}` });
  }

  return chunks;
}

const normalize = (vals) => {
  const n = Math.sqrt(vals.reduce((s, x) => s + x * x, 0)) || 1;
  return vals.map((x) => x / n);
};

async function embed(texts, GEMINI_KEY) {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models/${EMB_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMB_MODEL}`, content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: DIMS,
      })),
    }),
  }).then((x) => x.json());
  if (!r.embeddings) throw new Error(`embeddings falhou: ${(r.error?.message || "").slice(0, 120)}`);
  return r.embeddings.map((e) => normalize(e.values));
}

async function indexaUm(db, GEMINI_KEY, creator) {
  const [{ data: lb }, { data: fits }, { data: snaps }, { data: videos }] = await Promise.all([
    db.from("leaderboard").select("total, momentum, gravity, authority, window_bonus, janela_aberta, growth_30d").eq("id", creator.id).maybeSingle(),
    db.from("brand_fit").select("fit_score, rationale, brands(name)").eq("creator_id", creator.id).order("fit_score", { ascending: false }),
    db.from("snapshots").select("captured_at, followers, eng_rate, avg_views").eq("creator_id", creator.id).order("captured_at"),
    db.from("videos").select("title, views, content_score, analysis").eq("creator_id", creator.id).order("views", { ascending: false }).limit(12),
  ]);
  const chunks = buildChunks({ ...creator, ...(lb || {}) }, fits, snaps, videos);
  if (!chunks.length) return { handle: creator.handle, ok: false, motivo: "sem conteúdo indexável" };
  const vectors = await embed(chunks.map((c) => c.content), GEMINI_KEY);
  await db.from("creator_chunks").delete().eq("creator_id", creator.id);
  const { error } = await db.from("creator_chunks").insert(chunks.map((c, i) => ({
    creator_id: creator.id, chunk_type: c.chunk_type, content: c.content, embedding: vectors[i],
  })));
  if (error) return { handle: creator.handle, ok: false, motivo: error.message.slice(0, 100) };
  return { handle: creator.handle, ok: true, chunks: chunks.length };
}

const CREATOR_COLS = "id, handle, name, platform, niche, bio, followers, cache_per_video, kol_screen, brand_history, exec_brief, hire_plan, audience";

async function run(req) {
  const { GEMINI_KEY } = process.env;
  if (!GEMINI_KEY) return NextResponse.json({ error: "falta GEMINI_KEY" }, { status: 200 });

  const sp = new URL(req.url).searchParams;
  const handle = sp.get("handle");
  const n = Math.min(Number(sp.get("n")) || 10, 25);
  const db = supabaseAdmin();

  let alvos = [];
  if (handle) {
    const { data: c } = await db.from("creators").select(CREATOR_COLS).eq("handle", handle).single();
    if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
    alvos = [c];
  } else {
    // drain: creators ainda sem chunks
    const { data: existentes } = await db.from("creator_chunks").select("creator_id");
    const feitos = new Set((existentes || []).map((x) => x.creator_id));
    const { data: todos } = await db.from("creators").select(CREATOR_COLS).limit(1000);
    alvos = (todos || []).filter((c) => !feitos.has(c.id)).slice(0, n);
  }
  if (!alvos.length) return NextResponse.json({ ok: true, indexados: 0, motivo: "nenhum creator pendente" });

  const results = [];
  for (const c of alvos) {
    try { results.push(await indexaUm(db, GEMINI_KEY, c)); }
    catch (e) { results.push({ handle: c.handle, ok: false, motivo: String(e).slice(0, 100) }); }
  }
  return NextResponse.json({ ok: true, indexados: results.filter((r) => r.ok).length, de: alvos.length, resultados: results });
}
