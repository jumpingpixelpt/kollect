// Motivo legível de uma promoção falhada, para mostrar no card da Descoberta.
//
// As rotas de promoção devolvem o erro em dois níveis: `error` diz a categoria
// ("influencers.club recusou o enriquecimento") e `detalhe` traz a resposta real da
// API externa, que é a única coisa acionável — se a chave foi recusada, se o perfil
// não existe, se acabaram os créditos. Os componentes mostravam só o `error` e
// deitavam o `detalhe` fora, o que deixava o operador a olhar para "enrich falhou"
// sem forma nenhuma de saber o que fazer a seguir.
export function motivoDaFalha(j) {
  if (!j) return "erro desconhecido";
  const base = j.error || j.detalhes?.[0]?.motivo || j.fatal || "erro desconhecido";
  const det = j.detalhe || j.detalhes?.[0]?.detalhe || null;
  if (!det || String(det) === String(base)) return String(base);
  return `${base} — ${String(det).slice(0, 160)}`;
}
