/**
 * Categoria do creator — a faceta que define o GRUPO DE PARES.
 *
 * Não é rótulo decorativo. O `lib/cpe.js:42` monta o grupo de comparação de CPE com
 * `peers.filter((c) => c.category === target.category)`, e o `lib/recs.js:51` escolhe
 * recomendações por ela. Uma cabeleireira classificada como "skincare" é comparada com o
 * grupo errado e recebe recomendações erradas — silenciosamente, porque nada na interface
 * distingue uma categoria medida de uma categoria inventada.
 *
 * Vocabulário fechado, o mesmo do mapCategory de lib/tubular.js (que classifica a partir da
 * taxonomy da Tubular): make · skincare · cabelo · perfume · tech · lifestyle.
 *
 * PORQUE É QUE `null` É UM VALOR VÁLIDO E IMPORTANTE
 * A RPC ingest_profile faz, no conflito, `category = coalesce(excluded.category,
 * creators.category)`. Ou seja: um valor não-nulo SOBRESCREVE o que já lá estava, e só o
 * null preserva. A RPC foi desenhada para null significar "não sei" — mas o promote-apify
 * passava sempre "skincare" e o promote-tiktok sempre "cabelo", constantes que anulavam
 * esse desenho e que, a cada re-promoção, apagavam a categoria correcta que o tubular-sync
 * tinha escrito a partir da taxonomy. Daí os 1.611 creators em "make" e 13 em "skincare"
 * numa base que é 91% Instagram de beleza.
 *
 * Por isso: sem sinal no texto, devolve null. Adivinhar é pior do que não saber, porque a
 * adivinhação passa a facto e destrói o dado bom que estava por baixo.
 */

// Conta OCORRÊNCIAS, não primeira-correspondência. Com bio mais vinte legendas, o que
// identifica o território é a insistência: "make para pele oleosa" tem um termo de cada
// lado e é maquiagem, mas a primeira-que-casa dava skincare só por causa da ordem da lista.
//
// A ordem só desempata (ganha a primeira em caso de empate), e por isso está por
// especificidade decrescente: cabelo é o mais inequívoco, skincare o mais genérico — "pele"
// aparece em conteúdo de maquiagem a toda a hora, o inverso quase nunca.
//
// Fronteiras de palavra nos termos curtos: sem elas "liso" casava dentro de nomes próprios
// e "derma" dentro de "dermatologia" contava duas vezes pela mesma coisa.
const REGRAS = [
  // termos de tranças (trancista, braids, nagô, entrelace) entram porque são metade do
  // vocabulário capilar brasileiro e não têm a palavra "cabelo" lá dentro
  ["cabelo", /cabelo|cabelei|hair|crespo|cachead|cacho|capilar|\bliso|alisament|penteado|tranç|trancista|braids|nagô|entrelace|\bloiro|\bmech|coloraç/gi],
  ["perfume", /perfum|fragrân|fragranc|notas olfativ|amadeirad/gi],
  // "maquiad" (maquiador/maquiadora) faltava e é dos termos mais comuns em bios BR: sem ele,
  // "Maquiador oficial · Makeup & Hair" empatava 1-1 e caía em cabelo pelo desempate
  ["make", /\bmake|maquiad|maquiagem|makeup|batom|sombra|delineador|corretiv|blush|contorno|\bgloss|cílios|sobrancelh/gi],
  // "cosmét" ficou DE FORA de propósito: cosmético é beleza inteira, não skincare — com ele,
  // "Lifestyle & Beleza · dicas de cosméticos" era classificado como skincare, que é
  // exactamente o tipo de palpite que esta lista existe para não dar.
  ["skincare", /skincare|\bskin\b|\bpele\b|dermato|sérum|\bserum\b|acne|hidratant|protetor solar|\bfps\b/gi],
  ["tech", /gadget|smartphone|inteligência artificial/gi],
];

/**
 * Categoria a partir de texto livre (bio + legendas). Devolve null quando não há sinal —
 * ver a nota sobre o null no cabeçalho, não trocar por um valor por omissão.
 */
export function categoriaPorTexto(texto) {
  const t = String(texto || "");
  if (t.trim().length < 12) return null; // texto curto de mais para classificar seja o que for
  let melhor = null, maximo = 0;
  for (const [cat, re] of REGRAS) {
    const n = (t.match(re) || []).length;
    if (n > maximo) { maximo = n; melhor = cat; }
  }

  // SINAL MÍNIMO, proporcional ao tamanho do texto. Numa bio curta e focada, um termo já
  // é uma declaração de intenção. Em dois mil caracteres de legendas, um único acerto
  // solto é ruído — foi assim que uma creator de novelas do TikTok, sem uma palavra de
  // beleza em quinze títulos, ia parar a "skincare" por causa de uma correspondência
  // perdida. Categoria errada é pior do que categoria nenhuma: entra no grupo de pares do
  // CPE e ninguém repara.
  const minimo = t.length > 300 ? 2 : 1;
  return maximo >= minimo ? melhor : null;
}

/**
 * Junta bio e legendas num só texto para classificar. As legendas pesam por número: um
 * perfil com dez posts sobre cabelo é de cabelo, mesmo que a bio não o diga.
 */
export function textoParaCategoria(bio, legendas = []) {
  return [bio || "", ...legendas.filter(Boolean).slice(0, 20)].join(" ").slice(0, 4000);
}
