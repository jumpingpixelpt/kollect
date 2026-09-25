/**
 * PUBLI — o que conta como peça comercial.
 *
 * A régua vive aqui porque é lida em dois sítios com consequências diferentes: o
 * /api/brand-scan separa publi de orgânico para calcular o `brand_engagement`, e a ficha
 * do creator usa-a no selo PUBLI de cada peça e na saturação comercial. Duas cópias
 * divergiriam em silêncio, e a barra de saturação passaria a discordar da grelha de
 * conteúdos logo abaixo dela.
 *
 * NÃO usar `brand_history.indices_comerciais` para marcar peças na ficha: esses índices
 * apontam para a lista de legendas que o brand-scan mandou ao Claude, e essa lista vem da
 * Tubular (só cai no banco quando a Tubular falha, e aí sem ordenação estável). O que
 * parece um mapa para `videos` é a numeração de outra lista — casá-las marcaria a peça
 * errada como publi.
 */
export const RX_PUBLI = /#publi|publ1|#ad\b|#parceriapaga|link comissionado|comissionada?|recebidos|press\s?kit|\bID[.:\s]+[A-Z0-9]{2,}[A-Z0-9-]{3,}/i;

/** A peça declara relação comercial na legenda ou na fala transcrita. */
export function isPubli(v) {
  return RX_PUBLI.test(`${v?.title ?? ""}\n${v?.transcript ?? ""}`);
}

/**
 * Saturação comercial de um conjunto de peças: quantas são publi.
 * `pct` é sobre as peças do recorte — nunca sobre "o perfil", que não medimos.
 */
export function saturacaoPubli(videos) {
  const total = (videos || []).length;
  if (!total) return null;
  const publis = (videos || []).filter(isPubli);
  return { publis: publis.length, total, pct: Math.round((publis.length / total) * 1000) / 10 };
}
