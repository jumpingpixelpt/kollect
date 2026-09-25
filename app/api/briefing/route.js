import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * POST { creator_id, brand_id } — gera briefing de conteúdo pro creator no tom da marca.
 * Com ANTHROPIC_API_KEY usa Claude; sem, monta do template com os dados reais.
 */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "briefing", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  const { creator_id, brand_id } = await req.json();
  const [{ data: c }, { data: videos }, { data: brand }, { data: snaps }, { data: fit }] = await Promise.all([
    supabase.from("leaderboard").select("*").eq("id", creator_id).single(),
    supabase.from("videos").select("title, transcript, content_score, analysis").eq("creator_id", creator_id),
    supabase.from("brands").select("*").eq("id", brand_id).single(),
    supabase.from("snapshots").select("*").eq("creator_id", creator_id).order("captured_at"),
    supabase.from("brand_fit").select("fit_score").eq("creator_id", creator_id).eq("brand_id", brand_id).maybeSingle(),
  ]);
  if (!c || !brand) return NextResponse.json({ error: "creator ou marca não encontrados" }, { status: 404 });

  const last = snaps?.at?.(-1) || {};
  const temas = [...new Set((videos || []).flatMap((v) => v.analysis?.temas || []))].slice(0, 5);
  const p = brand.persona || {};

  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 1400,
        messages: [{ role: "user", content: `Gere um briefing de conteúdo de marca pro creator abaixo, no padrão de conteúdo DELE (não no da marca). Responda APENAS com JSON: {"sections":[{"title":"...","body":"..."}]} com 6 seções: Contexto, Objetivo, Conceito criativo, Formato & entregáveis, Tom & guardrails, KPIs.

MARCA: ${brand.name} — persona: ${JSON.stringify(p)}
CREATOR: ${c.name} (@${c.handle}, ${c.platform}, ${c.followers} seguidores, nicho ${c.niche}). Bio: ${c.bio}
Fit com a marca: ${fit?.fit_score ?? "?"}/100
Métricas: ${last.avg_views ?? "?"} views médias, eng ${last.eng_rate ?? "?"}%, ${last.saves_per_1k ?? "?"} saves/1k, ${last.shares_per_1k ?? "?"} shares/1k
Temas do conteúdo: ${temas.join(", ")}
Vídeos recentes: ${(videos || []).map((v) => `"${v.title}" (${v.content_score}/10)`).join("; ")}` }],
      }),
    });
    const out = await res.json();
    if (res.ok) {
      try {
        const _t = out.content[0].text;
        const parsed = JSON.parse((_t.match(/\{[\s\S]*\}/) || [_t])[0]);
        return NextResponse.json({ ...parsed, source: "claude" });
      } catch {}
    }
  }

  // fallback: template com os dados reais
  const fmtK = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : Math.round(n);
  const sections = [
    { title: "Contexto", body: `${c.name} (@${c.handle}) é ${c.niche.toLowerCase()} no ${c.platform} com ${fmtK(c.followers)} seguidores e Radar Score ${Number(c.total).toFixed(0)}/100. Fit com ${brand.name}: ${fit?.fit_score ? Number(fit.fit_score).toFixed(0) : "—"}/100. ${c.bio}` },
    { title: "Objetivo", body: `Colocar ${brand.name} dentro do território de ${temas.slice(0, 2).join(" e ") || c.niche.toLowerCase()} pela voz de quem a audiência já confia — consideração de marca com a credibilidade do creator, não alcance comprado.` },
    { title: "Conceito criativo", body: `O creator não adapta o conteúdo pra marca; a marca entra no formato que já funciona. Conceito: "${brand.name} dentro do método ${c.name.split(" ")[0]}" — o produto aparece como ferramenta do conteúdo que ele(a) já faria, mantendo o padrão que gera ${last.saves_per_1k ?? "—"} saves/1k.` },
    { title: "Formato & entregáveis", body: `1 vídeo principal (45–60s) no formato assinatura do creator + 1 sequência de stories de bastidor. Hook nos 2 primeiros segundos no padrão dele. Produto demonstrado em uso real — nada de unboxing genérico. 1 rodada de ajustes, liberdade editorial preservada.` },
    { title: "Tom & guardrails", body: `Tom da marca: ${p.tom || "—"}. Valores a respeitar: ${(p.valores || []).join(", ")}. Não fazer: promessa de resultado milagroso, leitura de release, esconder o #publi (disclosure obrigatório e natural). O veredito do creator é dele — patrocínio não compra opinião.` },
    { title: "KPIs", body: `Baseline atual: ${fmtK(last.avg_views || 0)} views médias, ${last.eng_rate ?? "—"}% de engajamento, ${last.saves_per_1k ?? "—"} saves/1k. Meta: performar no piso do baseline (conteúdo de marca que segura a média orgânica já é vitória) + saves como métrica-rainha: conteúdo guardado é consideração real.` },
  ];
  return NextResponse.json({ sections, source: "template" });
}
