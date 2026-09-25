import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { campanhaDoPedido } from "@/lib/casting-rota";
import { limitar } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * POST { creator_id, campaign_id, tipo } — AI Activation Studio.
 * tipo: "scripts" (3 roteiros) | "dm_pitch" | "creator_brief" | "usage_guidelines".
 * Tudo ancorado nos vídeos REAIS do creator + briefing da campanha.
 */
async function askHaiku(prompt, maxTokens = 1900) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 24000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    clearTimeout(timer);
    const out = await res.json();
    if (res.ok) return out.content[0].text;
  } catch {}
  return null;
}

export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "roteiros", max: 10, janelaMs: 60_000 });
  if (travado) return travado;
  const { creator_id, campaign_id, tipo = "scripts" } = await req.json();
  if (!campaign_id) return NextResponse.json({ error: "selecione uma campanha" }, { status: 400 });
  // posse do briefing (pentest set/2026, IDOR): os roteiros levam o briefing inteiro no prompt
  const acesso = await campanhaDoPedido(campaign_id, req);
  if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 403 });
  const [{ data: c }, { data: videos }, { data: bh }, { data: camp }] = await Promise.all([
    supabase.from("leaderboard").select("*").eq("id", creator_id).single(),
    supabase.from("videos").select("title, transcript, content_score, analysis, views").eq("creator_id", creator_id).order("views", { ascending: false }).limit(40),
    supabase.from("creators").select("brand_history, kol_screen").eq("id", creator_id).single(),
    campaign_id ? supabase.from("campaigns").select("name, briefing, parsed").eq("id", campaign_id).single() : Promise.resolve({ data: null }),
  ]);
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 404 });
  if (!camp) return NextResponse.json({ error: "selecione uma campanha" }, { status: 400 });

  const formatos = [...new Set((bh?.brand_history?.formatos || []).map((f) => (typeof f === "string" ? f : f?.nome || f?.formato)).filter(Boolean))].slice(0, 8);
  const temas = [...new Set((videos || []).flatMap((v) => v.analysis?.temas || []))].slice(0, 8);
  const nichos = (bh?.brand_history?.nichos || []).map((n) => `${n.nicho} ${n.pct}%`).join(", ");
  const comFala = (videos || []).filter((v) => v.transcript && v.transcript.length > 40).slice(0, 4);
  const trechos = comFala.map((v) => `• "${(v.title || "").slice(0, 80)}" → ${v.transcript.replace(/\s+/g, " ").slice(0, 280)}`).join("\n");
  const titulos = (videos || []).slice(0, 12).map((v) => `"${(v.title || "").slice(0, 90)}"`).join("; ");
  const keywords = (camp.parsed?.keywords || []).join(", ");
  const ctx = `CAMPANHA: ${camp.name}
BRIEFING: ${(camp.briefing || "—").slice(0, 1200)}
Território/keywords: ${keywords || "—"}
CREATOR: ${c.name} (@${c.handle}, ${c.platform}, ${c.followers} seguidores). Nichos: ${nichos || c.niche}.
Formatos que ele JÁ FAZ: ${formatos.join(", ") || "—"}
Temas: ${temas.join(", ") || "—"}
Títulos recentes: ${titulos || "—"}${trechos ? `\nTrechos reais de fala:\n${trechos}` : ""}`;

  // ───── entregáveis em texto (DM, brief, guidelines) ─────
  if (tipo !== "scripts") {
    const prompts = {
      dm_pitch: `Escreva uma DM curta (4-6 linhas, PT-BR) que o time da agência enviaria no Instagram pra @${c.handle} pitchando a parceria com a marca da campanha "${camp.name}". Tom humano e direto, com um elogio ESPECÍFICO ao conteúdo dela (cite o território/formato real), proposta clara e um convite leve pra conversar. Sem corporativês. Responda só com a mensagem, sem aspas.`,
      creator_brief: `Escreva um BRIEFING DE CONTEÚDO pronto pra enviar à creator @${c.handle} pra campanha "${camp.name}", PT-BR, ancorado no que ela JÁ FAZ. Estruture com: Objetivo, Entregáveis, Formato sugerido (use os formatos reais dela), Mensagens-chave, Do's & Don'ts, Liberdade editorial. Conciso e prático.`,
      client_defense: `Escreva uma DEFESA DE CLIENTE (client defense), PT-BR, 1 parágrafo pronto pra colar num email/deck justificando por que recomendar @${c.handle} pra campanha "${camp.name}". Ancore em território, autoridade de nicho, audiência qualificada e baixa saturação comercial. Tom executivo, sem exagero — evite "KOL consolidada" pra base pequena, prefira "autoridade de nicho".`,
      usage_guidelines: `Escreva as USAGE GUIDELINES (direitos e diretrizes de uso) dessa parceria entre a marca da campanha "${camp.name}" e a creator @${c.handle}, PT-BR. Cubra: período de uso do conteúdo, plataformas, repost/boost pago, exclusividade de categoria, disclosure obrigatório (#publi), e aprovação. Objetivo e em tópicos.`,
    };
    const prompt = prompts[tipo];
    if (!prompt) return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
    const texto = process.env.ANTHROPIC_API_KEY ? await askHaiku(`${prompt}\n\nCONTEXTO:\n${ctx}`, 1400) : null;
    return NextResponse.json({ tipo, texto: texto || "Não foi possível gerar agora — tente de novo.", campanha: camp.name });
  }

  // ───── scripts (3 roteiros) ─────
  if (process.env.ANTHROPIC_API_KEY) {
    const prompt = `Você é roteirista sênior de branded content. Gere 3 ROTEIROS de vídeo distintos pro creator dentro da campanha — regra de ouro: CADA roteiro nasce de um FORMATO QUE ELE JÁ FAZ (não invente formato genérico). A marca entra como ferramenta natural do conteúdo que ele já faria. Use o tom e os ganchos reais dele. PT-BR, pronto pra gravar.

Responda APENAS com JSON válido:
{"roteiros":[{"formato":"formato real dele","titulo":"título curto","duracao":"45s","gancho":"fala/cena dos 0-3s no tom dele","beats":[{"t":"0-3s","acao":"tela + fala"}] (3-5 beats),"entrada_marca":"onde/como o produto entra sem quebrar","cta":"chamada final","por_que_funciona":"1 frase"}]}
Exatamente 3 roteiros, formatos distintos.

${ctx}`;
    const txt = await askHaiku(prompt, 1900);
    if (txt) {
      try {
        const parsed = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]);
        if (parsed?.roteiros?.length) return NextResponse.json({ tipo, roteiros: parsed.roteiros, campanha: camp.name, source: "claude" });
      } catch {}
    }
  }
  const base = formatos.length ? formatos : ["Antes e depois", "Tutorial", "GRWM"];
  const roteiros = base.slice(0, 3).map((fmt) => ({
    formato: fmt, titulo: `${fmt} com o produto da ${camp.name}`, duracao: "45s",
    gancho: `Gancho no formato "${fmt}" que o creator já usa.`,
    beats: [{ t: "0-3s", acao: `Abre no padrão de "${fmt}".` }, { t: "3-25s", acao: `Desenvolve ${temas[0] || c.niche}; produto entra como ferramenta.` }, { t: "25-45s", acao: "Payoff + CTA." }],
    entrada_marca: `Produto em uso real no meio do conteúdo de ${temas[0] || c.niche}.`, cta: "CTA no tom do creator, sem esconder #publi.",
    por_que_funciona: `Nasce de "${fmt}", formato que a audiência já espera.`,
  }));
  return NextResponse.json({ tipo, roteiros, campanha: camp.name, source: "template" });
}
