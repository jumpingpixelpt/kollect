import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ErroProvedor } from "@/lib/erro-publico";
import { respostaErro } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";

export const maxDuration = 300;

/**
 * POST { brand_id } — extrai a persona da marca a partir dos vídeos do perfil oficial:
 * Apify puxa os últimos vídeos → Groq transcreve → Claude sintetiza a persona.
 *
 * Erros (feedback rodada 2, bug 1): só a mensagem amigável; o `detalhe` do provedor vai
 * para os logs e, na resposta, só a quem chama com o Bearer da orquestração.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const name = new URL(req.url).searchParams.get("name");
  try { return await run(req, name); } catch (e) { const { error, ...resto } = respostaErro(req, e, "pipeline/brand-persona"); return NextResponse.json({ fatal: error, ...resto }, { status: 200 }); }
}
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const { brand_id, name } = await req.json();
  try { return await run(req, name, brand_id); } catch (e) { const { error, ...resto } = respostaErro(req, e, "pipeline/brand-persona"); return NextResponse.json({ fatal: error, ...resto }, { status: 200 }); }
}

async function run(req, name, brand_id) {
  const { APIFY_TOKEN, GROQ_API_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!APIFY_TOKEN || !GROQ_API_KEY || !ANTHROPIC_API_KEY)
    return NextResponse.json(respostaErro(req, new ErroProvedor("config", 401, "configure APIFY_TOKEN, GROQ_API_KEY e ANTHROPIC_API_KEY"), "pipeline/brand-persona"), { status: 503 });
  const db = supabaseAdmin();
  const q = db.from("brands").select("*");
  const { data: brand } = brand_id ? await q.eq("id", brand_id).single() : await q.eq("name", name).single();
  if (!brand) return NextResponse.json({ error: "marca não encontrada" }, { status: 404 });

  // 1. últimos vídeos do perfil da marca
  const items = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=180`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: [brand.handle], resultsLimit: 8 }) }
  ).then((r) => r.json());

  // 2. transcreve cada um com Groq (ignora vídeo só com música, mas guarda a legenda)
  const transcripts = [];
  const captions = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 8)) {
    if (it.caption) captions.push(it.caption.slice(0, 200));
    const mediaUrl = it.videoUrl || it.video_url;
    if (!mediaUrl || transcripts.length >= 5) continue;
    try {
      const media = await fetch(mediaUrl);
      const form = new FormData();
      form.append("file", await media.blob(), "video.mp4");
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", "pt");
      const t = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, body: form,
      }).then((r) => r.json());
      const clean = (t.text || "").replace(/[♪♫\[\]()]/g, "").trim();
      if (clean.length >= 60 && !/^m[úu]sica[.!\s]*$/i.test(clean)) transcripts.push({ caption: it.caption, transcript: t.text });
    } catch {}
  }
  if (!transcripts.length && !captions.length) return NextResponse.json({ error: "nenhum vídeo transcrito nem legenda" }, { status: 422 });

  // 3. Claude sintetiza a persona
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 800,
      messages: [{ role: "user", content: `Abaixo estão transcrições e legendas dos últimos vídeos do perfil oficial brasileiro da marca ${brand.name}. Sintetize a persona de conteúdo da marca (como ela fala, o que valoriza, que temas vive). Responda APENAS com JSON: {"tom":"...", "valores":["até 4"], "temas":["até 4"], "resumo":"2 frases"}

TRANSCRIÇÕES (fala real dos vídeos):
${transcripts.map((t, i) => `Vídeo ${i + 1}: ${(t.transcript || "").slice(0, 800)}`).join("\n\n") || "(nenhuma — vídeos sem fala)"}

LEGENDAS:
${captions.slice(0, 8).join("\n") || "(nenhuma)"}` }],
    }),
  });
  const out = await res.json();
  if (!res.ok) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", res.status, out), "pipeline/brand-persona"), { status: res.status });
  const _t = out.content[0].text;
  const persona = JSON.parse((_t.match(/\{[\s\S]*\}/) || [_t])[0]);

  await db.from("brands").update({ persona: { ...persona, fonte: "transcrição real", videos_transcritos: transcripts.length, gerado_em: new Date().toISOString().slice(0, 10) } }).eq("id", brand.id);
  return NextResponse.json({ brand: brand.name, videos_transcritos: transcripts.length, legendas: captions.length, persona });
}
