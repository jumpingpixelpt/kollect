import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { alertarIa } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { creator_id, question, history?: [{role:"user"|"ai", text}] } — chat GLOBAL sobre
 * um creator, via RAG no pgvector: embed da pergunta (RETRIEVAL_QUERY) → match_creator_content
 * (chunks do creator + chunks dos vídeos dele) → Gemini responde só com o que foi recuperado.
 * A mesma função com filter_creator=null serve a futura busca semântica global.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

// Erros (feedback rodada 2, bug 1): a pergunta vem do ecrã do cliente, por isso as falhas
// técnicas (Gemini, RPC) são lançadas e saem daqui só como mensagem amigável + ref; o
// detalhe fica nos logs.
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "creator-chat", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); }
  catch (e) {
    const corpo = erroPublico(e, "creator-chat");
    await alertarIa(corpo, "creator-chat");
    return NextResponse.json(corpo, { status: 200 });
  }
}

async function run(req) {
  const { GEMINI_KEY } = process.env;
  const MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  if (!GEMINI_KEY) throw new ErroProvedor("gemini", 401, "falta GEMINI_KEY");

  const { creator_id, question, history = [] } = await req.json();
  if (!creator_id || !question?.trim()) return NextResponse.json({ error: "Escreva uma pergunta." }, { status: 200 });

  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("name, handle, platform, niche").eq("id", creator_id).single();
  if (!c) return NextResponse.json({ error: "Creator não encontrado." }, { status: 200 });

  // embed da pergunta (mesmo espaço vetorial dos chunks: 768d normalizado)
  const emb = await fetch(`${GEMINI_BASE}/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "models/gemini-embedding-001", content: { parts: [{ text: question.slice(0, 1500) }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }),
  }).then((r) => r.json());
  const vals = emb.embedding?.values;
  if (!vals) throw new ErroProvedor("gemini", emb.error?.code || 0, emb.error || "embedding falhou");
  const norm = Math.sqrt(vals.reduce((s, x) => s + x * x, 0)) || 1;

  const { data: hits, error: rpcErr } = await db.rpc("match_creator_content", {
    query_embedding: vals.map((x) => x / norm),
    match_threshold: 0.25,
    match_count: 12,
    filter_creator: creator_id,
  });
  if (rpcErr) throw new Error(`match_creator_content: ${rpcErr.message}`);
  if (!hits?.length) return NextResponse.json({ error: "O conteúdo deste creator ainda não foi analisado. Tente de novo depois da próxima atualização.", codigo: "sem_indice" }, { status: 200 });

  const contexto = hits.map((h, i) => `[${i + 1} · ${h.source}/${h.chunk_type}] ${h.content}`).join("\n\n");
  const system = `Você é o analista de creators do KOLLECT, plataforma de descoberta de talentos de beauty para a L'Oréal. Responda perguntas sobre a creator ${c.name} (@${c.handle}, ${c.platform}, nicho ${c.niche || "?"}) usando APENAS os trechos de contexto abaixo (vêm do índice semântico: perfil, score, screening, marcas, fit, audiência, briefs e análises de vídeo). Se a resposta não estiver no contexto, diga que essa informação ainda não foi coletada/analisada. Responda em pt-BR, direto e útil para decisões de marketing de influência. Nunca invente números. Responda em texto simples, SEM markdown: nunca use asteriscos, negrito, cabeçalhos ou tabelas; para listas use "- " no início da linha; nunca use travessão (—), use o hífen simples "-".

CONTEXTO RECUPERADO:
${contexto}`;

  const contents = [
    ...history.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: String(m.text || "").slice(0, 2000) }] })),
    { role: "user", parts: [{ text: question.slice(0, 2000) }] },
  ];

  const gen = await fetch(`${GEMINI_BASE}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
    }),
  }).then((r) => r.json());

  // garantia extra: remove markdown residual e travessões (a UI mostra texto puro)
  const answer = (gen.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim()
    .replace(/^\s*[\*•]\s+/gm, "- ").replace(/\*\*/g, "").replace(/^#{1,4}\s*/gm, "").replace(/[—–]/g, "-");
  if (!answer) throw new ErroProvedor("gemini", gen.error?.code || 0, gen.error || "sem resposta");
  return NextResponse.json({ answer, model: MODEL, fontes: hits.map((h) => `${h.source}/${h.chunk_type}`) });
}
