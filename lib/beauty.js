/**
 * Classificação de "marca de beauty" — usada para manter no filtro de Marca
 * apenas marcas do universo de beleza (decisão do cliente, jun/2026).
 *
 * Fonte da verdade preferencial: o campo `categoria` ("beleza"|"outra") que o
 * brand-scan (Claude) passa a gravar por marca. Para dados legados (gravados
 * antes desse deploy, sem `categoria`), caímos num heurístico conservador:
 * só consideramos beauty quando há sinal claro (termo de beleza no nome OU marca
 * de beleza conhecida). Marca desconhecida sem sinal fica de fora — o re-scan
 * com `categoria` recupera depois.
 */

export const norm = (s) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const key = (s) => norm(s).replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "");

// termos que, presentes no NOME da marca, indicam beleza
const BEAUTY_TERMS =
  /(beleza|beaut|makeup|make up|\bmake\b|maquiag|cosm[eé]?t|skin ?care|\bskin\b|\bpele\b|derma|capilar|cabel|\bhair\b|cacho|crespo|ruiv|alisa|\bliso\b|finalizad|peruca|megahair|\bnail|unha|esmalt|perfum|parfum|fragr|col[oô]nia|batom|gloss|corretiv|r[ií]mel|c[ií]lios|sobrancelha|\bbrow|\blash|bronze|autobronze|\bfps\b|protetor solar|s[eé]rum|hidratante|shampoo|condicionad|glam|hairsty|cabele)/i;

// marcas de beleza conhecidas SEM termo óbvio no nome (chaves normalizadas)
const KNOWN_BEAUTY = new Set([
  "dove","garnier","pantene","oceane","vizzela","maybelline","mac","maccosmetics",
  "toofaced","benefit","fenty","lancome","kerastase","kiko","kikomilano","avene",
  "eucerin","isdin","adcos","colorama","catharinehill","dermacolor","principia",
  "larocheposay","elseve","loreal","lorealparis","lorealprofessionnel","brunatavares",
  "babyliss","kilian","demarly","natura","naturatododia","oboticario","sephora",
  "neutrogena","niinasecrets","tomford","ysl","yvessaintlaurent","valentino","armani",
  "robertocavalli","xerjoff","ouiparis","ultraparfum","vichy","loccitane",
  "loccitaneaubresil","rubykisses","tangleteezer","softhair","trihair","mirra",
  "mirracosmeticos","hiven","hivencosmeticos","bauny","baunycosmeticos","apice",
  "apicecosmeticos","functionalcare","renovabe","blowgummies","reveracaps",
  "yamasterol","lisoetico","soulpower","mudconcept","misci","kemaby","luakan",
  "useintu","usepetala","useteteco","usebemmequero","uselol","abebeskin",
  "anagussonbeauty","fenzza","fenzzamakeup","karinafinalizadores","lipbalmme",
  "maximamakeupandhair","portaldasperucas","raquelhairstylis","oazeurofarma","oaz",
  "soaethic","tashaetracie","tashatracie","curaprox","kerastase","bncachos",
  "brendapinellohair","milenaeliasmethod","dicasdakeraida","nairastudio","ojosol","oleopaixao","mundoricca","dailus","creamy","cerave","salonline","rubyrose",
  "skala","eudora","neutrogena","neutrogenabrasil","melu","brunatavares","pantene","principia","garnier",]);

// termos que, presentes no NOME, indicam claramente NÃO-beauty (revista/moda/
// hotelaria/automóvel/eletrônico/games) — prioridade sobre os termos de beleza
// para evitar falsos positivos tipo "Glamour"/"Vogue Beauty" (revistas) no filtro.
const NON_BEAUTY_TERMS =
  /(\brevista\b|magazine|\bvogue\b|glamour|\belle\b|\bmoda\b|fashion|\bjoias\b|jewel|\bhotel\b|palace|resort|automov|multimarcas|\bcar\b|gamescom|\bgames?\b|iphone|smartphone|\bbanco\b)/i;

// exceções nomeadas: marcas que passariam no heurístico mas NÃO são beauty
// (umbrella/guarda-chuva, shapewear, moda) — decisão do cliente jun/2026.
const CURATED_OUTRA = new Set([
  "blunt", "bluntbrasil",            // guarda-chuvas
  "donnashape", "donnashapeoficial", // shapewear / cinta modeladora
  "misci",                            // moda
  "maisoncasaconceito",               // decoracao/casa (IA marcou "beleza" por engano)
]);

// -- filtro de PRODUTO vs MARCA (jun/2026) --------------------------------
// A IA as vezes extrai um TIPO DE PRODUTO ("Protetor Solar FPS 70", "Serum
// Vitamina C") em vez do nome da marca. Isso nao e marca e polui o filtro.
// Heuristica conservadora: se o rotulo e composto SO por palavras genericas de
// produto (+ specs/numeros) e NAO contem nenhuma marca conhecida, e produto.
const PRODUCT_WORDS = new Set([
  "protetor","solar","fps","serum","hidratante","creme","cremes","gel","agua",
  "micelar","base","corretivo","po","blush","iluminador","bronzer","contorno",
  "primer","fixador","batom","gloss","rimel","mascara","cilios","delineador",
  "lapis","sombra","paleta","esmalte","shampoo","condicionador","leavein",
  "finalizador","oleo","manteiga","sabonete","esfoliante","tonico","demaquilante",
  "perfume","colonia","kit","combo","refil","vitamina","acido","hialuronico",
  "retinol","niacinamida","colageno","spray","locao","balm","balsamo","mousse",
  "pomada","liquida","liquido","facial","corporal","matte","compacto","duo",
]);
const PRODUCT_STOP = new Set(["de","da","do","das","dos","com","para","em","the","of"]);

/** Rotulo e um tipo de produto generico (nao uma marca)? */
export function isGenericProduct(label) {
  if (!label) return false;
  const n = norm(label);
  const allToks = n.split(/[^a-z0-9]+/).filter(Boolean);
  // contem marca conhecida em qualquer token (>=3) -> NAO e produto generico
  if (allToks.some((t) => t.length >= 3 && KNOWN_BEAUTY.has(t))) return false;
  // spec clara de produto: "FPS 70", "50ml", "30g" -> produto
  if (/\bfps\s*\d+/.test(n) || /\b\d+\s*(ml|g|gr|fps)\b/.test(n)) return true;
  // tokens significativos: >=2 chars, nao-numericos, fora de stopwords
  const toks = allToks.filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !PRODUCT_STOP.has(t));
  if (!toks.length) return false;
  // generico = TODOS os tokens significativos sao palavras de produto
  return toks.every((t) => PRODUCT_WORDS.has(t));
}

/**
 * @param {string} label  nome original da marca
 * @param {string} [categoria]  "beleza"|"outra" (quando o brand-scan já gravou)
 */
export function isBeautyBrand(label, categoria) {
  // denylist nomeada tem prioridade ate sobre a categoria da IA (corrige mislabel "beleza")
  if (label && CURATED_OUTRA.has(key(label))) return false;
  // tipo de produto generico nao e marca -- fora do filtro, mesmo se IA marcou "beleza"
  if (isGenericProduct(label)) return false;
  if (categoria != null && String(categoria).trim() !== "") {
    return /belez|beaut/i.test(norm(categoria));
  }
  if (!label) return false;
  if (NON_BEAUTY_TERMS.test(norm(label))) return false;
  if (BEAUTY_TERMS.test(label) || KNOWN_BEAUTY.has(key(label))) return true;
  // marcas conhecidas em nomes compostos (ex.: "Maybelline NY Brasil", "Elseve Collagen
  // Lifter"): casa por TOKEN exato (>=3 chars) pra nao pegar prefixo de palavra alheia.
  const toks = norm(label).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (toks.some((t) => t.length >= 3 && KNOWN_BEAUTY.has(t))) return true;
  // marcas conhecidas escritas em duas palavras (ex.: "Ruby Rose", "Soft Hair")
  for (let i = 0; i < toks.length - 1; i++)
    if (KNOWN_BEAUTY.has(toks[i] + toks[i + 1])) return true;
  return false;
}


// ── Dedup de variantes → tag canônica (decisão do cliente jun/2026) ──────────
const ALIASES = {
  mac: "MAC", maccosmetics: "MAC", macbrasil: "MAC",
  armani: "Armani", armanibeauty: "Armani",
  larocheposay: "La Roche-Posay", cicaplast: "La Roche-Posay",
  creamy: "Creamy",
  skala: "Skala", donaskala: "Skala", skalabrasil: "Skala",
  eudora: "Eudora", eudorasiage: "Eudora", siage: "Eudora",
  lorealparis: "L'oréal Paris", loreal: "L'oréal Paris", elseve: "L'oréal Paris",
  fenzza: "Fenzza", fenzzamakeup: "Fenzza",
  garnier: "Garnier", garnierbrasil: "Garnier", lorealgarnier: "Garnier",
  brunatavares: "Bruna Tavares", linhabrunatavares: "Bruna Tavares", bt: "Bruna Tavares",
  rubyrose: "Ruby Rose", rubyrosebrasil: "Ruby Rose", melu: "Ruby Rose", melubrasil: "Ruby Rose",
  natura: "Natura", naturabro: "Natura", naturatododia: "Natura",
  neutrogena: "Neutrogena", neutrogenabrasil: "Neutrogena", neutrogina: "Neutrogena", neutroginabrasil: "Neutrogena",
  pantene: "Pantene", pantenebrasil: "Pantene",
  principia: "Principia", principiaskincare: "Principia",
};

/** Tag canônica da marca (junta variantes); se não houver alias, o rótulo original. */
export function canonicalBrandLabel(label) {
  return ALIASES[key(label)] || (label ?? "");
}

// ── Denylist do filtro de Marca (decisão do cliente jun/2026) ────────────────
// Prioridade sobre KNOWN_BEAUTY e sobre a categoria da IA.
// OBS: a regra literal "remover qualquer coisa com espaço" NÃO foi aplicada —
// apagaria marcas legítimas de 2+ palavras (La Roche-Posay, Ruby Rose, Bruna
// Tavares, L'oréal Paris, Salon Line…). Aguardando confirmação do cliente.
const DENY_EXACT = new Set([
  "priscila","raquel","raphaela","mayara","tereza","sophie","monique","tamara",
  "thaysa","triondas","mussolini","ofc","oaz","oazeurofarma","oziz","oyan","ojosol",
  "oleopaixao","perola","petrizi","profumo","regenesis","renova","revera","rodrigoramas",
  "rosaselvagem","roseblack","skii","softhari","solotica","suasssuna","emmequero",
  "use","uselol","usebemmequero","xerjoff","elastico","goldfield","lumeye","lipbalmme",
  "lilissuperbonita","madeixasdamarina","maiaraguinther","marianacordeirobeauty",
  "mateuscordeirobe","mechascriativas","meleg","mihana","mirra","mudconcept","mystica",
  "numbuzin","luubarbosabeauty","lidiabrandolt","lentesnaturalvision","kvdbeauty",
  "dicasdakeraida","farmaciademanipulacao","funcionalcare","rannerbeauty","lisoetico",
]);
const DENY_TOKENS = new Set(["dra","use","ultra","universo","peel"]);
const DENY_SUBSTR = [
  "make","designer","studio","unha","cilio","nail","peruca",
  "skincare","skin care","maison","protetor solar","desconhec",
];

/** A marca deve ser REMOVIDA do filtro? (denylist do cliente) */
export function isExcludedBrand(label) {
  if (!label) return true;
  const k = key(label);
  if (DENY_EXACT.has(k)) return true;
  const n = norm(label);
  const toks = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (toks.some((t) => DENY_TOKENS.has(t))) return true;
  if (DENY_SUBSTR.some((s) => n.includes(s))) return true;
  return false;
}

export default isBeautyBrand;
