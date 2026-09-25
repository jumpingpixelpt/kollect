// TERRITÓRIO DE CONTEÚDO — a classificação de cada creator (decisão do cliente, set/2026).
//
// Cinco territórios, e não os sete buckets que a base carregava: cílios e estética eram
// recortes do screening, não linguagem de quem monta casting. Ficam dobrados no território
// vizinho — cílios em maquiagem (rímel, extensão, olhar), estética em skincare (pele,
// procedimento, dermato) — para que nenhuma creator perca a classificação por causa da
// mudança de régua.
//
// NOTA: o pré-filtro do briefing (/api/campaign) tem uma cópia própria deste vocabulário,
// ainda na escala de sete buckets. Não foi unificada de propósito: dobrar cílios e estética
// lá dentro faria creators desses buckets passarem a casar com briefings de maquiagem e
// skincare, ou seja, mudaria castings já entregues. Unificar é uma decisão de negócio, não
// de arrumação — e tem de ser tomada com quem lê os castings.
export const TERRITORIOS = [
  ["cabelo", "Cabelo"],
  ["maquiagem", "Maquiagem"],
  ["skincare", "Skincare"],
  ["unhas", "Unha"],
  ["perfume", "Perfume"],
  // Lifestyle é o sexto território do radar do cliente — está escrito no prompt do
  // brand-scan ("use como território um destes 6 … Lifestyle só quando o conteúdo de beleza
  // for minoria real"), e é o que a IA já escreve em 257 creators desta base. Não é uma
  // gaveta de sobras: é a resposta para quem foi analisado e não faz beleza. Fica em último
  // porque, em empate de vocabulário, é a beleza que manda.
  ["lifestyle", "Lifestyle"],
];

export const TERRITORIO_LABEL = Object.fromEntries(TERRITORIOS);

// Buckets do screening que não são território próprio → onde caem.
const DOBRA = { cilios: "maquiagem", estetica: "skincare" };

/** Vocabulário de cada território, como aparece em vídeos de TikTok/Instagram BR. */
export const NICHE_TERMS = {
  cabelo: ["cabelo","cabelos","capilar","hair","fios","cacho","cachos","crespo","crespos","loiro","mechas","liso","progressiva","tran[çc]a","trancas","trança","mega hair","fibra","volume","densidade","queda","finaliza","cronograma","colora","ruivo"],
  maquiagem: ["maquiagem","make","makeup","batom","base","rimel","rímel","sombra","contorno","blush","delineado","glam","cilios","cílios","lash","lashes","extensão de cílios"],
  skincare: ["skincare","skin care","pele","dermo","serum","sérum","hidratante facial","acne","poros","protetor solar","colageno facial","antissinais","estetica","estética","botox","preenchimento","harmonizacao","harmonização","procedimento","dermato"],
  unhas: ["unha","unhas","nail","nails","esmalte","manicure"],
  perfume: ["perfume","perfumaria","fragrancia","fragrância","fragrance","cheiro"],
  lifestyle: ["lifestyle","estilo de vida"],
};

/**
 * Texto livre → território, pelo vocabulário que mais bate (termos DISTINTOS, não
 * ocorrências). null se nada bater.
 *
 * `minHits` sobe conforme o texto: num nicho escrito pela IA ("cronograma capilar") um
 * acerto é o sinal todo; numa bio inteira mais os títulos de todos os vídeos, um acerto é
 * ruído — "pele" aparece na bio de um creator de musculação e classificava-o como skincare.
 */
export function territorioDoTexto(txt, minHits = 1) {
  if (!txt) return null;
  const t = String(txt).toLowerCase();
  let best = null, bestN = 0;
  for (const [b, terms] of Object.entries(NICHE_TERMS)) {
    let n = 0;
    for (const w of terms) { if (bate(t, w)) n++; }
    if (n > bestN) { bestN = n; best = b; }
  }
  return bestN >= minHits ? best : null;
}

// O termo tem de COMEÇAR uma palavra. Sem isto, "make" casava dentro de videomaker,
// filmmaker e storymaker, e photographers de moda entravam como creators de maquiagem.
// Só a fronteira à esquerda: à direita ficaria de fora o plural e o diminutivo — "pele"
// não acharia "peles", que é a mesma coisa dita de outra maneira.
const BORDA = "[^0-9a-zà-ÿ]";
function bate(texto, termo) {
  try { return new RegExp(`(^|${BORDA})(${termo})`).test(texto); }
  catch { return texto.includes(termo); }
}

/** Bucket do screening (7 valores + "outros") → território (5 valores). */
export function territorioDoBucket(bucket) {
  if (!bucket || bucket === "outros") return null;
  const b = DOBRA[bucket] ?? bucket;
  return TERRITORIO_LABEL[b] ? b : null;
}

/**
 * O território de uma creator, por ordem de autoridade:
 *
 *  1. `guardado` — creators.territorio, apurado a partir de evidência funda (bio, títulos
 *     dos vídeos, análises do deep-scan) por scripts/classificar-territorio.mjs. Só existe
 *     para quem os dois passos seguintes não resolvem, e por isso não tapa o screening.
 *  2. o bucket do screening, que é medida sobre o conteúdo real, com densidade.
 *  3. o que se sabe da creator: nichos escritos pela IA, nicho da ficha, categoria.
 *
 * Sem os três, null — e "sem território" é uma resposta honesta: há creators fora dos
 * cinco territórios (fitness, lifestyle, comida) que só teriam um se lho inventássemos.
 */
export function territorioDe({ guardado = null, bucket = null, textos = [], analisado = false } = {}) {
  if (guardado && TERRITORIO_LABEL[guardado]) return guardado;
  const achado = territorioDoBucket(bucket) ?? territorioDoTexto(textos.filter(Boolean).join(" "));
  if (achado) return achado;
  // `analisado` = a IA já leu o conteúdo desta creator (brand_history.nichos) e não lhe achou
  // beleza. Isso é uma resposta — "Lifestyle" —, não uma lacuna. Sem esta linha, 270 creators
  // ficavam num limbo de "sem território" indistinguível de quem nunca foi analisado, que é
  // um problema diferente e tem outra solução (importar vídeos e correr o brand-scan).
  return analisado ? "lifestyle" : null;
}
