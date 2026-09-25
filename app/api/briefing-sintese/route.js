import { NextResponse } from "next/server";
import { LIMITE_BRIEFING } from "@/lib/briefing-campos";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { alertarIa } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Síntese de um documento anexado em briefing de busca — o passo entre o anexo e a leitura.
 *
 * Feedback do cliente (set/2026, pontos 4 e 5): o formulário colava o texto do anexo na
 * caixa e cortava aos 3.000 caracteres com uma mensagem técnica. Um briefing de 12 páginas
 * cortado à terceira não é o briefing. Aqui o documento inteiro vai ao modelo, que devolve
 * só o que é briefing de creators — território, produto, objetivo, público, plataforma,
 * restrições, referências — dentro do limite que a caixa aceita. A pessoa vê o resultado
 * na caixa, edita, e só depois pede a leitura (/api/briefing-parse).
 *
 * POST { texto, titulo?, marca? } → { briefing, caracteres_lidos }
 * Erros em 200 com { error }, como o resto das rotas — só a mensagem amigável de
 * lib/erro-publico.js (feedback rodada 2, bug 1); o detalhe do provedor vai para os logs.
 */
const MODEL = "claude-haiku-4-5-20251001";
const MAX_ENTRADA = 120000; // ~30k tokens — chega para um deck de 40 páginas

export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "briefing-sintese", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  const key = process.env.ANTHROPIC_API_KEY;
  const falhar = async (e) => {
    const corpo = erroPublico(e, "briefing-sintese");
    await alertarIa(corpo, "briefing-sintese");
    return NextResponse.json(corpo, { status: 200 });
  };
  if (!key) return falhar(new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada"));

  let body = {};
  try { body = await req.json(); } catch { /* corpo inválido → tratado abaixo */ }
  const texto = String(body.texto || "").trim().slice(0, MAX_ENTRADA);
  const titulo = String(body.titulo || "").trim();
  const marca = String(body.marca || "").trim();
  if (!texto) return NextResponse.json({ error: "O documento não tem texto para resumir.", codigo: "vazio" }, { status: 200 });

  const alvo = Math.round(LIMITE_BRIEFING * 0.85);
  const prompt = `Você é head de creator strategy de beleza (L'Oréal Brasil). Recebeu um documento (briefing de campanha, deck, e-mail ou planilha) e precisa de o transformar num BRIEFING DE BUSCA DE CREATORS, em português do Brasil, para uma plataforma que encontra creators de TikTok e Instagram.

Escreva SÓ o que o documento diz — nunca invente marca, produto, público ou objetivo. Se algo não estiver no documento, não o mencione.

Organize em parágrafos curtos, nesta ordem quando houver informação: produto/marca e o que a campanha lança ou defende; objetivo (awareness, engajamento ou venda); território de conteúdo (cabelo, unha, maquiagem, pele, perfume) e temas concretos; público-alvo; plataforma prioritária; perfil de creator procurado e exemplos citados; o que NÃO queremos (concorrentes, restrições, temas proibidos); datas ou premissas que afetem a escolha de creators.

Deixe de fora: cronogramas de produção, orçamento, KPIs de mídia, assinaturas, disclaimers jurídicos, cabeçalhos de slides e tudo o que não ajude a escolher creators.

LIMITE ABSOLUTO: ${alvo} caracteres. Texto corrido, sem títulos em markdown, sem listas com marcadores.
${titulo ? `\nTÍTULO DA BUSCA: ${titulo}` : ""}${marca ? `\nMARCA/CLIENTE: ${marca}` : ""}

DOCUMENTO:
${texto}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const out = await res.json();
    if (!res.ok) return falhar(new ErroProvedor("anthropic", res.status, out));
    // o modelo insiste em títulos e negrito em markdown apesar do pedido (smoke de 11/09):
    // a caixa é texto corrido, e "**" e "#" ficavam à vista
    const briefing = String(out?.content?.[0]?.text ?? "")
      .replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "")
      .trim().slice(0, LIMITE_BRIEFING);
    if (!briefing) return falhar(new Error("briefing-sintese: o modelo não devolveu texto"));
    return NextResponse.json({ briefing, caracteres_lidos: texto.length });
  } catch (e) {
    return falhar(e);
  }
}

// GET só para diagnóstico manual (a convenção da casa: rotas disparáveis à mão)
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "briefing-sintese", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  return NextResponse.json({ ok: true, modelo: MODEL, limite: LIMITE_BRIEFING });
}
