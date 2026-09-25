import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";

export const maxDuration = 120;

/**
 * POST { video_id, media_url } — baixa o áudio e transcreve com Groq (whisper-large-v3).
 */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "GROQ_API_KEY não configurada" }, { status: 503 });

  const { video_id, media_url } = await req.json();
  if (!video_id || !media_url) return NextResponse.json({ error: "video_id e media_url são obrigatórios" }, { status: 400 });

  const media = await fetch(media_url);
  if (!media.ok) return NextResponse.json({ error: `não consegui baixar a mídia (${media.status})` }, { status: 422 });
  const blob = await media.blob();

  const form = new FormData();
  form.append("file", blob, "video.mp4");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const out = await res.json();
  if (!res.ok) return NextResponse.json({ error: out }, { status: res.status });

  await supabaseAdmin().from("videos").update({ transcript: out.text }).eq("id", video_id);
  return NextResponse.json({ video_id, transcript: out.text });
}
