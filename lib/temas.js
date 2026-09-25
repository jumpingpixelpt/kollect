// TEMAS DA EXPANSÃO (feedback rodada 2, F1.2 — set/2026): o que o briefing-parse devolve
// em `temas[]` — {rotulo, termos_pt[], termos_en[], situacoes[]} — e a confirmação mostra
// como chips. Funções puras, sem dependências: correm no browser (BriefingReview), no
// servidor (/api/campaign, lib/busca-semantica.js) e no test-busca.mjs.

const txt = (v) => String(v ?? "").trim();
const lista = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : [])
  .map((x) => txt(x)).filter(Boolean);

/** Limpa o que veio do modelo ou da confirmação: rótulo obrigatório, listas sem vazios nem repetidos. */
export function normalizarTemas(temas) {
  if (!Array.isArray(temas)) return [];
  const vistos = new Set();
  const out = [];
  for (const t of temas) {
    const rotulo = txt(typeof t === "string" ? t : t?.rotulo);
    if (!rotulo) continue;
    const k = rotulo.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    const uniq = (a) => [...new Set(a.map((x) => x.toLowerCase()))];
    out.push({
      rotulo,
      termos_pt: uniq(lista(t?.termos_pt)).slice(0, 12),
      termos_en: uniq(lista(t?.termos_en)).slice(0, 8),
      situacoes: lista(t?.situacoes).slice(0, 6),
    });
  }
  return out.slice(0, 20);
}

/** Todos os termos dos temas (pt + en), minúsculos e sem repetidos. */
export const termosDosTemas = (temas) =>
  [...new Set(normalizarTemas(temas).flatMap((t) => [...t.termos_pt, ...t.termos_en]))];

/** keywords ∪ termos dos temas — as keywords originais primeiro (o funil usa as 15 primeiras). */
export function keywordsComTemas(keywords, temas) {
  const base = (Array.isArray(keywords) ? keywords : []).map((k) => txt(k).toLowerCase()).filter(Boolean);
  return [...new Set([...base, ...termosDosTemas(temas)])];
}

