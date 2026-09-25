/**
 * SCORECARD POR REDE — o retrato de 90 dias de cada conta do creator.
 *
 * 90 e não 30 (feedback do cliente, set/2026, ponto 13: "sempre considerar dos últimos 90
 * dias"; decisão do Rui de 11/09 a aceitar o custo): o import-videos passou a trazer até 30
 * peças por perfil para a janela ter corpo.
 *
 * A janela é declarada, não presumida. Um creator cuja última importação foi há três
 * semanas não tem 30 dias de dados, e um cabeçalho a dizer "últimos 30 dias" por cima de
 * peças de julho é a mentira mais fácil de cometer nesta página. Quando a janela pedida
 * não tem peças que cheguem, o recorte cai nas últimas `minimo` peças e diz que caiu —
 * `fallback` + as datas reais viajam no resultado para o ecrã as escrever.
 *
 * Taxa de engajamento é engajamentos ÷ views (lib/engagement.js) — nunca sobre seguidores.
 */
import { engRateViews } from "./engagement.js";

const soma = (arr, f) => arr.reduce((s, v) => s + (Number(f(v)) || 0), 0);

/** Engajamentos de uma peça: só o que a fonte mediu (shares/saves faltam com frequência). */
export const engDaPeca = (v) => (v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0);

export function scorecardRede(videos, { dias = 90, hoje = new Date(), minimo = 12 } = {}) {
  const todas = (videos || [])
    .filter((v) => v.posted_at)
    .sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
  if (!todas.length) return null;

  const corte = new Date(hoje.getTime() - dias * 864e5).toISOString().slice(0, 10);
  const naJanela = todas.filter((v) => String(v.posted_at) >= corte);
  const fallback = naJanela.length < 3;
  const sel = fallback ? todas.slice(0, minimo) : naJanela;
  if (!sel.length) return null;

  const views = soma(sel, (v) => v.views);
  const eng = soma(sel, engDaPeca);
  const comentarios = soma(sel, (v) => v.comments);
  const n = sel.length;

  return {
    fallback, dias,
    // as peças do recorte viajam com o resultado: a saturação comercial conta exatamente
    // estas, e não um refiltro por data (dias com duas publicações davam totais diferentes)
    pecas: sel,
    de: sel.at(-1).posted_at, ate: sel[0].posted_at,
    posts: n,
    views, eng, comentarios,
    viewsMedia: Math.round(views / n),
    engMedia: Math.round(eng / n),
    comentariosMedia: Math.round(comentarios / n),
    taxaEng: engRateViews(eng, views),
  };
}
