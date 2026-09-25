import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx&n=15 — indexação semântica (processo tokforge): quebra cada análise
 * de vídeo em até 6 chunks tipados (hook/structure/transcript/metrics/visual_audio/kollect),
 * gera embeddings com o Gemini (gemini-embedding-001, 768d) e grava em video_chunks (pgvector).
 * Drain idempotente: pega vídeos com analysis e sem chunks; disparada pelo deep-scan
 * ao fim de cada varredura e chamável à mão pra backfill dos vídeos antigos.
 * Busca a jusante: rpc match_video_chunks(query_embedding, threshold, count, creator).
 */
const EMB_MODEL = "gemini-embedding-001";
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const DIMS = 768;

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "video-embeddings", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

const j = (arr, sep = ", ") => (arr || []).filter(Boolean).join(sep);

// os 6 chunks tipados por vídeo — texto denso, com contexto do creator pra retrieval
function buildChunks(v, creator) {
  const a = v.analysis || {};
  const head = `Creator: ${creator?.name || creator?.handle || "?"} (@${creator?.handle || "?"}). Vídeo: ${v.title || "sem título"}.`;
  const chunks = [];

  if (a.hook?.description)
    chunks.push({ chunk_type: "hook", content: `${head} Hook (${a.hook.type || "?"}, ${a.hook.score ?? "?"}/100): ${a.hook.description}` });

  const blocos = (a.structure || []).map((b) => `${b.block} ${b.start_second}s–${b.end_second}s`);
  const template = (a.template?.blocks || []).map((b) => `${b.label}: ${b.placeholder} (${b.duration_seconds}s)`);
  if (blocos.length || template.length)
    chunks.push({ chunk_type: "structure", content: `${head} Estrutura narrativa: ${j(blocos)}. Ritmo: ${a.rhythm?.style || "?"} (${a.rhythm?.cuts_per_second ?? "?"} cortes/seg). Template replicável: ${j(template, " | ")}` });

  if (v.transcript)
    chunks.push({ chunk_type: "transcript", content: `${head} Transcrição: ${v.transcript.slice(0, 4000)}` });

  chunks.push({
    chunk_type: "metrics",
    content: `${head} Categoria: ${a.category || "?"}. Views: ${v.views ?? "?"}, likes: ${v.likes ?? "?"}, comentários: ${v.comments ?? "?"}, shares: ${v.shares ?? "?"}. Viral score: ${a.viral_score?.total ?? "?"}/100 (hook ${a.viral_score?.breakdown?.hook_strength ?? "?"}, edição ${a.viral_score?.breakdown?.edit_quality ?? "?"}, estrutura ${a.viral_score?.breakdown?.structure_clarity ?? "?"}, áudio ${a.viral_score?.breakdown?.audio_energy ?? "?"}). Duração: ${a.duration_seconds ?? "?"}s.`,
  });

  const ost = (a.onscreen_text || []).slice(0, 12);
  if (a.visual || a.audio || ost.length)
    chunks.push({ chunk_type: "visual_audio", content: `${head} Visual: câmera ${a.visual?.camera_movement || "?"}, enquadramento ${a.visual?.framing || "?"}, cores ${j(a.visual?.dominant_colors)}. Áudio: energia ${a.audio?.energy || "?"}, ${a.audio?.bpm_estimate ?? "?"} BPM, voz ${a.audio?.has_voice ? "sim" : "não"}, mood ${a.audio?.music_mood || "?"}. Texto na tela: ${j(ost, " / ")}` });

  const dims = [["expertise", a.expertise], ["originalidade", a.originalidade], ["didática", a.didatica], ["brand safety", a.brand_safety], ["nota de conteúdo", a.content_score]]
    .filter(([, n]) => n != null).map(([k, n]) => `${k} ${n}/10`);
  const marcas = (a.marcas_citadas || []).map((m) => `${m.marca} (${m.contexto})`);
  if (dims.length || a.veredicto || marcas.length)
    chunks.push({ chunk_type: "kollect", content: `${head} Leitura KOLLECT: ${j(dims)}. Temas: ${j(a.temas)}. Veredicto: ${a.veredicto || "?"}. Marcas citadas: ${j(marcas, " | ") || "nenhuma"}.` });

  return chunks;
}

// embeddings truncados a 768d precisam de renormalização (recomendação da doc do Gemini)
const normalize = (vals) => {
  const n = Math.sqrt(vals.reduce((s, x) => s + x * x, 0)) || 1;
  return vals.map((x) => x / n);
};

async function embed(texts, GEMINI_KEY) {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models/${EMB_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMB_MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: DIMS,
      })),
    }),
  }).then((x) => x.json());
  if (!r.embeddings) throw new Error(`embeddings falhou: ${(r.error?.message || "").slice(0, 120)}`);
  return r.embeddings.map((e) => normalize(e.values));
}

async function run(req) {
  const { GEMINI_KEY } = process.env;
  if (!GEMINI_KEY) return NextResponse.json({ error: "falta GEMINI_KEY" }, { status: 200 });

  const sp = new URL(req.url).searchParams;
  const n = Math.min(Number(sp.get("n")) || 15, 30);
  const handle = sp.get("handle");
  const db = supabaseAdmin();

  let creatorFilter = null;
  if (handle) {
    const { data: c } = await db.from("creators").select("id").eq("handle", handle).single();
    if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
    creatorFilter = c.id;
  }

  const { data: pendentes, error: rpcErr } = await db.rpc("videos_pendentes_indexacao", { limit_n: n, filter_creator: creatorFilter });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 200 });
  if (!pendentes?.length) return NextResponse.json({ ok: true, indexados: 0, motivo: "nenhum vídeo pendente" }, { status: 200 });

  // nomes dos creators pro contexto dos chunks
  const cids = [...new Set(pendentes.map((v) => v.creator_id).filter(Boolean))];
  const { data: creators } = await db.from("creators").select("id, handle, name").in("id", cids);
  const byId = Object.fromEntries((creators || []).map((c) => [c.id, c]));

  const results = [];
  for (const v of pendentes) {
    try {
      const chunks = buildChunks(v, byId[v.creator_id]);
      if (!chunks.length) { results.push({ video_id: v.id, ok: false, motivo: "análise sem conteúdo indexável" }); continue; }
      const vectors = await embed(chunks.map((c) => c.content), GEMINI_KEY);
      await db.from("video_chunks").delete().eq("video_id", v.id); // idempotente em reindexação
      const { error } = await db.from("video_chunks").insert(chunks.map((c, i) => ({
        video_id: v.id, creator_id: v.creator_id, chunk_type: c.chunk_type, content: c.content, embedding: vectors[i],
      })));
      if (error) { results.push({ video_id: v.id, ok: false, motivo: error.message.slice(0, 100) }); continue; }
      results.push({ video_id: v.id, ok: true, chunks: chunks.length });
    } catch (e) {
      results.push({ video_id: v.id, ok: false, motivo: String(e).slice(0, 100) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, indexados: okCount, de: pendentes.length, resultados: results });
}
