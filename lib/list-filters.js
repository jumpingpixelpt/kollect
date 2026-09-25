// Filtros e ordenação da lista de creators — partilhados entre o servidor
// (lib/radar-data.js, que os aplica sobre a base inteira) e o cliente
// (components/BuscaCreators.js, que só desenha os controlos).
//
// Viviam só no RadarListing, e por isso corriam apenas sobre a fatia já
// carregada pelo scroll infinito: procurar "Rui" com 48 de 1.765 creators em
// memória devolvia os Ruis dessas 48 e mais nenhum. Passaram para aqui quando a
// busca/faixa/tipo/ordenação foram para o servidor — os rótulos e as regras têm
// de ser os mesmos dos dois lados, senão o dropdown promete um recorte que a
// query não faz.
//
// O valor null de cada lista é "sem filtro" e o seu texto é o NOME do filtro: a barra
// de busca (set/2026) não tem etiqueta por cima dos dropdowns — o dropdown fechado
// diz o que é, e aberto diz o que está escolhido.

// Faixas de seguidores da barra de busca (set/2026). Eram <10k · 10–50k · 50–200k · 200k+,
// cortes do funil de descoberta; estas são as faixas com que o cliente fala de casting.
export const BANDS = [
  [null, "Seguidores"], ["lt50", "Até 50K"], ["50_200", "50K – 200K"],
  ["200_500", "200K – 500K"], ["gt500", "Acima de 500K"],
];

// Classificação: "Só KOL" é a classe kol do §8 (lib/kolscore.js); "KOL + Pool" é toda a
// gente com classe — quem cruza os cortes de elegibilidade do briefing, KOL incluído
// (rising star, hidden gem, brand safe performer, elegível). Sem escolha, a base toda,
// inelegíveis e por calcular incluídos.
export const CLASSIFICACOES = [
  [null, "Classificação"], ["kol", "Só KOL"], ["pool", "KOL + Pool"],
];

// Valores que a barra deixou de oferecer mas que a URL continua a aceitar — os atalhos
// antigos (?l=rising_star, ?l=janela) não podem passar a devolver "nenhum creator".
export const CLASSIFICACAO_LEGADO = {
  rising_star: "★ Rising Star", hidden_gem: "💎 Hidden Gem",
  brand_safe_performer: "🛡 Brand Safe Performer", elegivel: "◇ Elegível", janela: "◈ Janela Aberta",
};

// Só as redes que a base tem ou vai ter. "X" saiu do dropdown (zero creators); a URL
// continua a aceitá-lo em lib/radar-data.js.
export const PLATAFORMAS = [
  [null, "Plataforma"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"],
];

// Tier (feedback rodada 2, set/2026 — F3.1, [D11]): as faixas com que o cliente fala de
// casting. Substituem as faixas de "Seguidores" na barra do Creators Hub; o parâmetro `fw`
// (BANDS) continua aceite pela URL para os links antigos não caírem.
// Conta-se POR CONTA, não somado: numa pessoa com várias redes (agrupada por person_key em
// lib/radar-base.js) o tier é o da maior conta isolada — ver tierFollowers.
export const TIERS = [
  [null, "Tier"], ["nano", "Nano · até 10K"], ["micro", "Micro · 10K – 50K"], ["mid", "Mid · 50K – 200K"],
  ["macro", "Macro · 200K – 1M"], ["mega", "Mega · acima de 1M"],
];
export const TIER_LABEL = { nano: "Nano", micro: "Micro", mid: "Mid", macro: "Macro", mega: "Mega" };

const TIER_KEYS = new Set(TIERS.map(([k]) => k).filter(Boolean));
export const isTier = (t) => TIER_KEYS.has(t);

// Seguidores que decidem o tier: a maior conta isolada da pessoa (accounts[].followers, que
// a montagem já traz por conta); sem contas, os seguidores da linha. Nunca o
// followers_combined — somar redes fazia de duas micro uma mid.
export function tierFollowers(c) {
  const porConta = (c?.accounts || []).map((a) => Number(a?.followers || 0));
  return porConta.length ? Math.max(...porConta) : Number(c?.followers || 0);
}

export function tierDe(followers) {
  const f = Number(followers || 0);
  if (f < 10e3) return "nano";
  if (f < 50e3) return "micro";
  if (f < 200e3) return "mid";
  if (f < 1e6) return "macro";
  return "mega";
}

export const inTier = (c, t) => !t || tierDe(tierFollowers(c)) === t;

const BAND_KEYS = new Set(BANDS.map(([k]) => k).filter(Boolean));

export const isBand = (b) => BAND_KEYS.has(b);

export function inBand(followers, b) {
  const f = Number(followers || 0);
  if (b === "lt50") return f < 50e3;
  if (b === "50_200") return f >= 50e3 && f < 200e3;
  if (b === "200_500") return f >= 200e3 && f < 500e3;
  if (b === "gt500") return f >= 500e3;
  return true;
}

export function matchClassificacao(c, l) {
  if (!l) return true;
  if (l === "kol") return !!(c.is_kol ?? c.classe === "kol");
  if (l === "pool") return !!c.classe;
  if (l === "janela") return !!c.janela_aberta;
  if (l === "rising_star") return !!(c.is_rising_star ?? c.classe === "rising_star");
  return c.classe === l;
}

// Colunas ordenáveis da vista em lista (clique no cabeçalho).
// `er` é a taxa de engajamento (engajamentos ÷ views, lib/engagement.js) — coluna E.R. do Hub.
export const SORT_KEYS = ["kol", "total", "match", "followers", "eng", "er", "views", "cache", "cpe"];

export function sortVal(c, k) {
  switch (k) {
    // `kol` é o Score KOL do briefing (view leaderboard.kol_nota) — o mesmo número que o card
    // e a ficha mostram. `total` é o Radar Score, outra régua e outra pergunta: continua
    // ordenável na sua própria coluna, com o seu nome.
    case "kol": return c.kol_nota != null ? Number(c.kol_nota) : null;
    case "total": return c.total != null ? Number(c.total) : null;
    case "match": return c.camp?.match != null ? Number(c.camp.match) : null;
    case "followers": return Number(c.followers_combined ?? c.followers ?? 0);
    case "eng": return c.eng_per_post != null ? Number(c.eng_per_post) : null;
    case "er": return c.eng_rate != null ? Number(c.eng_rate) : null;
    case "views": return (c.views_per_post ?? c.avg_views) != null ? Number(c.views_per_post ?? c.avg_views) : null;
    case "cache": return c.cache_per_video != null ? Number(c.cache_per_video) : null;
    case "cpe": return (c.cache_per_video != null && c.eng_per_post) ? Number(c.cache_per_video) / Number(c.eng_per_post) : null;
    default: return null;
  }
}

// Comparador estável: nulos sempre no fim, nos dois sentidos.
export function bySort(key, dir = "desc") {
  return (a, b) => {
    const va = sortVal(a, key), vb = sortVal(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir === "asc" ? va - vb : vb - va;
  };
}
