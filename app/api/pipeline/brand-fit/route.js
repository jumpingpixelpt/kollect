import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ErroProvedor } from "@/lib/erro-publico";
import { respostaErro } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";

export const maxDuration = 120;

/**
 * POST { creator_id } — Claude compara as transcrições do creator com a persona
 * de cada marca e grava um Brand Fit Score 0–100 por marca.
 *
 * Erros (feedback rodada 2, bug 1): só a mensagem amigável; o `detalhe` do provedor vai
 * para os logs e, na resposta, só a quem chama com o Bearer da orquestração.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const handle = new URL(req.url).searchParams.get("handle");
  try { return await run(req, null, handle); } catch (e) { const { error, ...resto } = respostaErro(req, e, "pipeline/brand-fit"); return NextResponse.json({ fatal: error, ...resto }, { status: 200 }); }
}
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const { creator_id } = await req.json();
  try { return await run(req, creator_id, null); } catch (e) { const { error, ...resto } = respostaErro(req, e, "pipeline/brand-fit"); return NextResponse.json({ fatal: error, ...resto }, { status: 200 }); }
}

async function run(req, creator_id, handle) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada"), "pipeline/brand-fit"), { status: 503 });

  const db = supabaseAdmin();
  const cq = db.from("creators").select("id, name, handle, niche, bio, brand_history");
  const { data: creator } = creator_id ? await cq.eq("id", creator_id).single() : await cq.eq("handle", handle).single();
  if (!creator) return NextResponse.json({ error: "creator não encontrado" }, { status: 404 });
  const [{ data: videos }, { data: brands }] = await Promise.all([
    db.from("videos").select("title, transcript").eq("creator_id", creator.id).order("views", { ascending: false }).limit(15),
    db.from("brands").select("id, name, persona"),
  ]);
  if (!videos?.length) return NextResponse.json({ error: "creator sem vídeos" }, { status: 422 });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 900,
      messages: [{ role: "user", content: `Você avalia o fit entre creators e marcas da divisão DPGP da L'Oréal.

CREATOR: ${creator.name} (@${creator.handle}) — ${creator.niche}. Bio: ${creator.bio}
LEGENDAS E TRANSCRIÇÕES DOS VÍDEOS:\n${videos.map((v) => `• ${(v.title || "").slice(0, 150)}${v.transcript ? ` | fala: ${v.transcript.slice(0, 300)}` : ""}`).join("\n")}
HISTÓRICO COMERCIAL: ${creator.brand_history ? JSON.stringify(creator.brand_history.marcas?.slice(0, 8)) : "desconhecido"}

PERSONAS DAS MARCAS:\n${brands.map((b) => `• ${b.name}: ${JSON.stringify(b.persona)}`).join("\n")}

Para cada marca, dê um fit 0–100 (tom, valores, temas, adequação da voz do creator à persona da marca) e uma justificativa de 1 frase. Responda APENAS com JSON: [{"marca":"...", "fit":0-100, "justificativa":"..."}]` }],
    }),
  });
  const out = await res.json();
  if (!res.ok) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", res.status, out), "pipeline/brand-fit"), { status: res.status });
  const _t = out.content[0].text;
  const fits = JSON.parse((_t.match(/\[[\s\S]*\]/) || _t.match(/\{[\s\S]*\}/) || [_t])[0]);

  for (const f of fits) {
    const brand = brands.find((b) => b.name === f.marca);
    if (!brand) continue;
    await db.from("brand_fit").delete().eq("brand_id", brand.id).eq("creator_id", creator.id);
    await db.from("brand_fit").insert({ brand_id: brand.id, creator_id: creator.id, fit_score: f.fit, rationale: f.justificativa });
  }
  return NextResponse.json({ creator: creator.handle, fits });
}
