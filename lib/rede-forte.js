/**
 * REDE MAIS FORTE — em que rede a creator rende mais, por objetivo do briefing
 * (feedback rodada 2, F1.8). PROPOSTA de 21/09/2026, à espera da resposta do cliente à D5
 * (docs/duvidas-feedback-rodada2.md): se o cliente mudar os critérios, muda aqui.
 *
 * Regra determinística, sem LLM — explicável e grátis. Lê só o creators.metricas_rede
 * (lib/metricas-rede.js, janela de 90 dias):
 *
 *  - Só há leitura com PELO MENOS DUAS redes com dados. Uma rede "tem dados" com ≥ 3 peças
 *    no recorte, views médias > 0 e seguidores conhecidos (para awareness) / taxa de
 *    engajamento calculada (para engajamento).
 *  - AWARENESS → a rede com maior alcance relativo: views médias ÷ seguidores. Empate
 *    (diferença < 5%) desempata pelas views médias absolutas.
 *  - ENGAJAMENTO → a rede com maior taxa de engajamento (engajamentos ÷ views, nunca sobre
 *    seguidores — lib/engagement.js). Quando as taxas ficam a menos de 10% uma da outra,
 *    decide a média de comentários por peça (a conversa pesa no engajamento).
 *  - O objetivo do briefing (parsed.objetivo — Awareness | Engajamento | Venda, ou texto
 *    livre nos briefings antigos) decide qual dos dois selos vem primeiro. Venda vai com
 *    engajamento à frente (é a leitura mais próxima de conversão); sem objetivo, awareness.
 *
 * A frase compara com os PARES quando o número existe: `eng_index` do kol_screen
 * (engajamento face à mediana dos pares do mesmo território e banda de seguidores) e
 * `indice_faixa` da conversa (comentários face à faixa). São números da conta da linha, não
 * da rede — por isso a frase diz "engajamento acima dos pares", sem atribuí-lo a uma rede.
 * Sem esses números, a frase compara só as redes entre si.
 */

const NOME = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
export const nomeRede = (p) => NOME[p] || p;

const num = (x, casas = 1) => Number(x).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 });

/** "awareness" | "engajamento" | "venda" | null a partir do objetivo do briefing. */
export function objetivoDe(parsed) {
  const t = String(parsed?.objetivo || "").toLowerCase();
  if (!t.trim()) return null;
  // texto livre (briefings antigos): vale o primeiro conceito que aparece
  const achados = [
    ["awareness", t.search(/awareness|alcance|notoriedade|reconhecimento|consideração|consideracao|lançamento|lancamento|visibilidade/)],
    ["engajamento", t.search(/engaj|comunidade|conversa|interaç|interac/)],
    ["venda", t.search(/venda|conversão|conversao|compra|sell/)],
  ].filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]);
  return achados[0]?.[0] ?? null;
}

function redesComDados(m) {
  return Object.entries(m?.redes || {})
    .map(([rede, r]) => ({ rede, ...r }))
    .filter((r) => (r.n_pecas || 0) >= 3 && (r.views_media || 0) > 0);
}

function melhorAwareness(redes) {
  const cand = redes.filter((r) => r.seguidores > 0).map((r) => ({ ...r, alcance: r.views_media / r.seguidores }));
  if (cand.length < 2) return null;
  cand.sort((a, b) => {
    const dif = Math.abs(a.alcance - b.alcance) / Math.max(a.alcance, b.alcance);
    return dif < 0.05 ? b.views_media - a.views_media : b.alcance - a.alcance;
  });
  const [top, seg] = cand;
  return { rede: top.rede, top, seg, razao: seg.alcance > 0 ? top.alcance / seg.alcance : null };
}

function melhorEngajamento(redes) {
  const cand = redes.filter((r) => r.eng_rate != null);
  if (cand.length < 2) return null;
  cand.sort((a, b) => {
    const dif = Math.abs(a.eng_rate - b.eng_rate) / Math.max(a.eng_rate, b.eng_rate, 0.01);
    return dif < 0.1 ? (b.comentarios_media || 0) - (a.comentarios_media || 0) : b.eng_rate - a.eng_rate;
  });
  const [top, seg] = cand;
  return { rede: top.rede, top, seg };
}

/** Comparação com os pares: [texto, positivo?] ou null. */
function leituraPares(ix, rotulo, alvo) {
  if (ix == null || !Number.isFinite(Number(ix))) return null;
  const v = Number(ix);
  if (v >= 1.2) return [`${rotulo} acima ${alvo} (${num(v)}×)`, true];
  if (v < 0.8) return [`${rotulo} abaixo ${alvo} (${num(v)}×)`, false];
  return [`${rotulo} na linha ${alvo}`, null];
}

const juntar = (base, par) => {
  if (!par) return `${base}.`;
  const [txt, pos] = par;
  return `${base}${pos === false ? ", mas " : pos ? " e " : "; "}${txt}.`;
};

/**
 * @param {object} metricas  creators.metricas_rede
 * @param {object} opts      { objetivo: parsed.objetivo normalizado ou o parsed inteiro,
 *                             engIndex: kol_screen.metricas.eng_index,
 *                             indiceFaixa: conversa.volume.indice_faixa }
 * @returns {Array<{objetivo, rede, rotulo, selo, frase}>} vazio sem duas redes com dados
 */
export function redeMaisForte(metricas, { objetivo = null, engIndex = null, indiceFaixa = null } = {}) {
  const redes = redesComDados(metricas);
  if (redes.length < 2) return [];
  const out = [];

  const aw = melhorAwareness(redes);
  if (aw) {
    const vs = aw.razao && aw.razao >= 1.05 ? ` (${num(aw.razao)}× as views por seguidor do ${nomeRede(aw.seg.rede)})` : "";
    out.push({
      objetivo: "awareness", rede: aw.rede, rotulo: nomeRede(aw.rede),
      selo: `Rede mais forte · awareness: ${nomeRede(aw.rede)}`,
      frase: juntar(`Forte em views no ${nomeRede(aw.rede)}${vs}`, leituraPares(indiceFaixa, "comentários", "da faixa")),
    });
  }

  const en = melhorEngajamento(redes);
  if (en) {
    const base = `Mais engajamento no ${nomeRede(en.rede)} (${num(en.top.eng_rate, 2)}% vs ${num(en.seg.eng_rate, 2)}% no ${nomeRede(en.seg.rede)}${en.top.comentarios_media != null ? ` · ${num(en.top.comentarios_media, 0)} comentários por peça` : ""})`;
    out.push({
      objetivo: "engajamento", rede: en.rede, rotulo: nomeRede(en.rede),
      selo: `Rede mais forte · engajamento: ${nomeRede(en.rede)}`,
      frase: juntar(base, leituraPares(engIndex, "engajamento", "dos pares")),
    });
  }

  const obj = typeof objetivo === "object" && objetivo ? objetivoDe(objetivo) : objetivo;
  const primeiro = obj === "engajamento" || obj === "venda" ? "engajamento" : "awareness";
  return out.sort((a, b) => (a.objetivo === primeiro ? -1 : b.objetivo === primeiro ? 1 : 0));
}
