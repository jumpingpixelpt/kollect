// Arredondamento único para o que vai ao ecrã.
//
// Números que chegam de médias (views/post, engajamentos, taxas, pct de nicho, saldo do
// Tubular) vêm com toda a precisão do float — 533.3636363636364 — e apareciam assim sempre
// que o formatador local só tratava do milhar para cima. Regra do site (set/2026):
//  - CONTAGENS (views, engajamentos, seguidores, peças) são inteiras abaixo de mil e
//    abreviadas em k/M acima — é o que fazem os `fmt` locais das páginas e componentes.
//    Ninguém tem 380,46 engajamentos por vídeo.
//  - TAXAS, PERCENTAGENS e DINHEIRO ficam com duas casas no máximo.
// `r2` é a passagem obrigatória para valores do segundo grupo que entram numa string sem
// passar por um formatador; devolve o que recebeu se não for número, para não transformar
// null/"—" em NaN.
export const r2 = (n) => {
  if (n == null || n === "") return n;
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : n;
};
