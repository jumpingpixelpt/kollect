import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { alertarIa } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { video_id, question, history?: [{role:"user"|"ai", text}] } — chat sobre UM vídeo
 * (processo tokforge chat-with-video): responde com o Gemini usando como contexto a análise
 * multimodal completa + transcrição guardadas em videos. Sem RAG: o contexto de um vídeo
 * cabe inteiro no prompt. Histórico limitado às últimas 6 mensagens.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

// Erros (feedback rodada 2, bug 1): a pergunta vem do ecrã do cliente, por isso as falhas
// técnicas (Gemini) são lançadas e saem daqui só como mensagem amigável + ref; o detalhe
// fica nos logs.
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "video-chat", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); }
  catch (e) {
    const corpo = erroPublico(e, "video-chat");
    await alertarIa(corpo, "video-chat");
    return NextResponse.json(corpo, { status: 200 });
  }
}

async function run(req) {
  const { GEMINI_KEY } = process.env;
  const MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
  if (!GEMINI_KEY) throw new ErroProvedor("gemini", 401, "falta GEMINI_KEY");

  const { video_id, question, history = [] } = await req.json();
  if (!video_id || !question?.trim()) return NextResponse.json({ error: "Escreva uma pergunta." }, { status: 200 });

  const db = supabaseAdmin();
  const { data: v } = await db.from("videos").select("id, title, views, likes, comments, shares, transcript, analysis, creator_id").eq("id", video_id).single();
  if (!v?.analysis) return NextResponse.json({ error: "Este vídeo ainda não foi analisado.", codigo: "sem_analise" }, { status: 200 });
  const { data: c } = await db.from("creators").select("name, handle, niche").eq("id", v.creator_id).single();

  const contexto = `CREATOR: ${c?.name || "?"} (@${c?.handle || "?"}), nicho: ${c?.niche || "?"}
VÍDEO: "${v.title || "sem título"}" · ${v.views ?? "?"} views, ${v.likes ?? "?"} likes, ${v.comments ?? "?"} comentários, ${v.shares ?? "?"} shares
ANÁLISE MULTIMODAL (JSON): ${JSON.stringify(v.analysis).slice(0, 14000)}
TRANSCRIÇÃO COMPLETA: ${(v.transcript || "(sem fala)").slice(0, 6000)}`;

  const system = `Você é o analista de conteúdo do KOLLECT, plataforma de descoberta de creators de beauty para a L'Oréal. Responda perguntas sobre ESTE vídeo específico usando APENAS o contexto fornecido (análise multimodal + transcrição). Cite timestamps (ex: "aos 12s") quando relevante. Se pedirem roteiro/script, use a estrutura e o template da análise como molde. Se a resposta não estiver no contexto, diga que a análise não cobre isso. Responda em pt-BR, direto e útil para decisões de marketing de influência. Nunca invente números. Responda em texto simples, SEM markdown: nunca use asteriscos, negrito, cabeçalhos ou tabelas; para listas use "- " no início da linha; nunca use travessão (—), use o hífen simples "-".

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
  return NextResponse.json({ answer, model: MODEL });
}
