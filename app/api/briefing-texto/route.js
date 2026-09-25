import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel corta o corpo de uma função serverless em 4,5 MB; abaixo disso para a mensagem ser
// nossa e não um 413 sem explicação.
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST (corpo = o PDF em bruto, Content-Type application/pdf) → { texto, paginas, vazio }
 *
 * Extrai o texto de um briefing em PDF para a caixa do formulário (pedido do utilizador,
 * 03/09/2026: "+ Anexar briefing" recusava PDF). É extração de texto, não leitura por IA:
 * determinística, grátis e em segundos — a IA entra depois, no /api/briefing-parse, sobre o
 * texto que a pessoa viu e pôde corrigir na caixa.
 *
 * Um PDF digitalizado (imagem sem camada de texto) sai com `vazio: true`: o formulário diz
 * isso em vez de mandar uma caixa em branco para a leitura. OCR não entra aqui de propósito —
 * é outro custo e outra dependência, e o caso ainda não apareceu.
 *
 * Erros em 200 com { error }, como o resto das rotas.
 */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "briefing-texto", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) return NextResponse.json({ error: "ficheiro vazio" });
    if (bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: `PDF com ${(bytes.length / 1048576).toFixed(1)} MB — o limite é 4 MB. Exporta só as páginas do briefing.` });
    }
    // %PDF- nos primeiros bytes: um .pdf que não é PDF (HTML de erro gravado com esse nome,
    // por exemplo) falha aqui com uma frase útil em vez de um erro do parser.
    const cabecalho = String.fromCharCode(...bytes.slice(0, 5));
    if (cabecalho !== "%PDF-") return NextResponse.json({ error: "o ficheiro não é um PDF válido" });

    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const texto = String(text || "")
      .replace(/\u00ad/g, "")       // hífen suave (U+00AD), invisível, que o pdf.js deixa nas quebras
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return NextResponse.json({ texto, paginas: totalPages, vazio: !texto });
  } catch (e) {
    // o motivo técnico (pdf.js) vai para os logs; ao cliente, só a frase (feedback rodada 2, bug 1)
    console.error("[briefing-texto] PDF ilegível:", e?.stack || e);
    return NextResponse.json({ error: "Não foi possível ler este PDF. Tente exportá-lo de novo ou cole o texto na caixa.", codigo: "pdf_ilegivel" });
  }
}
