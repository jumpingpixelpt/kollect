// CSV do squad (feedback rodada 2, F2.4 — set/2026). Separador `;` e BOM UTF-8: é o que o
// Excel em pt-BR abre direto em colunas e com acentos (com `,` abre tudo numa coluna só).
// Números em formato pt-BR (vírgula decimal), já que o separador de campo é o `;`.
import { CURADORIA_LABEL } from "./squad-curadoria.js";
import { TAG_LABEL } from "./casting.js";

export const CSV_BOM = "﻿";
const REDE = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

/**
 * Uma célula CSV: sempre entre aspas (nomes e notas trazem `;`, quebras de linha e aspas).
 * Injeção de fórmulas (pentest set/2026): nomes, @ e notas vêm das redes e de quem escreve
 * no squad; uma célula a começar por = + - @ ou tab/CR seria executada pelo Excel como
 * fórmula (=HYPERLINK, =cmd|…). Prefixa-se um apóstrofo, que o Excel trata como texto.
 */
export const celulaCsv = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/** Linhas → texto CSV com `;`, CRLF e BOM. */
export function csvPtBr(linhas) {
  return CSV_BOM + linhas.map((l) => l.map(celulaCsv).join(";")).join("\r\n");
}

const numero = (v) => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const inteiro = (v) => numero(v) == null ? "" : String(Math.round(numero(v)));
const decimal = (v) => numero(v) == null ? "" : numero(v).toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });

export const COLUNAS_SQUAD = ["Creator", "@", "Rede", "Link do perfil", "Seguidores", "Views médias", "Comentários", "Engajamento", "E.R. (%)", "Status", "Notas", "Território", "Tag"];

/**
 * Membros do snapshot (lib/squad-data.js) → linhas do CSV. As mesmas contas da tabela:
 * Engajamento = views médias × E.R. (interações médias por peça, proposta da D6); E.R. =
 * engajamentos ÷ views; sem dado fica vazio, nunca 0.
 */
export function linhasCsvSquad(items = []) {
  const linhas = [COLUNAS_SQUAD];
  for (const it of items) {
    const p = it.creator || it.prospect || {};
    const m = it.creator_id ? it.metrics : null;
    const views = numero(m?.avg_views), er = numero(m?.eng_rate);
    const handle = p.handle ? `@${String(p.handle).replace(/^@+/, "")}` : "";
    linhas.push([
      p.name || handle,
      handle,
      REDE[p.platform] || p.platform || "",
      it.perfil_url || "",
      inteiro(p.followers),
      inteiro(views),
      inteiro(it.media_comentarios),
      views != null && er != null ? inteiro(views * er / 100) : "",
      decimal(er),
      CURADORIA_LABEL[it.curadoria] || CURADORIA_LABEL.sugerida,
      it.notas || "",
      it.territorio || "",
      TAG_LABEL[it.tag] || (it.creator_id ? "Sem classificação" : "A analisar"),
    ]);
  }
  return linhas;
}

/** Nome de ficheiro seguro a partir do nome do squad. */
export const nomeArquivo = (nome, ext) => `squad-${String(nome || "squad").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "squad"}.${ext}`;
