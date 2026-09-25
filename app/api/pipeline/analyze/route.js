import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ErroProvedor } from "@/lib/erro-publico";
import { respostaErro } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";

export const maxDuration = 60;

/**
 * POST { video_id } — analisa a transcrição com Claude e grava content_score + análise.
 *
 * Erros (feedback rodada 2, bug 1): só a mensagem amigável; o `detalhe` do provedor vai
 * para os logs e, na resposta, só a quem chama com o Bearer da orquestração.
 */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada"), "pipeline/analyze"), { status: 503 });

  const { video_id } = await req.json();
  const db = supabaseAdmin();
  const { data: video } = await db.from("videos").select("id, title, transcript").eq("id", video_id).single();
  if (!video?.transcript) return NextResponse.json({ error: "vídeo sem transcrição — rode /api/pipeline/transcribe antes" }, { status: 422 });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `Você avalia creators de beauty para descoberta de talentos da L'Oréal. Analise a transcrição abaixo e responda APENAS com JSON válido no formato:
{"expertise": 0-10, "originalidade": 0-10, "didatica": 0-10, "brand_safety": 0-10, "content_score": 0-10, "temas": ["até 3 temas"], "veredicto": "1 frase"}

expertise = domínio técnico real de beauty; originalidade = voz própria vs. surfar trend; didatica = ensina e forma opinião; brand_safety = adequação a marca global; content_score = nota geral ponderada.

Título: ${video.title}
Transcrição: ${video.transcript}`,
      }],
    }),
  });
  const out = await res.json();
  if (!res.ok) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", res.status, out), "pipeline/analyze"), { status: res.status });

  let analysis;
  try { analysis = JSON.parse(out.content[0].text.replace(/```json|```/g, "").trim()); }
  catch { return NextResponse.json(respostaErro(req, new Error(`resposta não-JSON do modelo: ${String(out.content?.[0]?.text ?? "").slice(0, 300)}`), "pipeline/analyze"), { status: 502 }); }

  await db.from("videos").update({ analysis, content_score: analysis.content_score }).eq("id", video_id);
  return NextResponse.json({ video_id, analysis });
}
