/**
 * Engajamento padrão da plataforma: SEMPRE engajamento ÷ views (em %).
 *
 * Decisão do cliente (jun/2026): a taxa de engajamento exibida no Radar é
 * eng/views — nunca eng/seguidores. Quando não há views disponíveis na fonte,
 * retorna null (não substituímos por uma base de seguidores, que distorce a
 * comparação entre creators).
 *
 * @param {number} engagements  soma de engajamentos (likes + comentários [+ shares])
 * @param {number} views        soma de views do mesmo recorte
 * @returns {number|null} taxa em %, 2 casas, ou null se não há views
 */
export function engRateViews(engagements, views) {
  const e = Number(engagements);
  const v = Number(views);
  if (!Number.isFinite(e) || !Number.isFinite(v) || v <= 0 || e < 0) return null;
  return Math.round((e / v) * 10000) / 100;
}

export default engRateViews;
