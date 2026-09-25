/**
 * Mapa canónico de CONCORRENTES para a camada de saturação (briefing L'Oréal §5/§8.4).
 *
 * v1 · capilar — lista proposta internamente em 25/07/2026, PENDENTE de validação
 * com o cliente (pergunta aberta nº 1 do plano). Ajustar aqui quando o cliente
 * responder; o resto do motor não muda.
 *
 * Duas listas separadas de propósito:
 *  - CONCORRENTES: marcas de capilar de grupos rivais — contam para o nível de saturação.
 *  - INTERNAS_LOREAL: marcas do próprio grupo L'Oréal — reportadas à parte
 *    ("saturação interna"), NÃO contam no nível até o cliente decidir (pergunta nº 1).
 *
 * A normalização usa a MESMA semântica do resto da app (lib/beauty.js):
 * key(canonicalBrandLabel(label)) como chave de agregação.
 */
import { norm, key, canonicalBrandLabel } from "./beauty.js";

// grupo → marcas → aliases (chaves já no formato de key(): minúsculas, sem acentos/símbolos)
const CONCORRENTES = [
  { id: "pantene", label: "Pantene", grupo: "P&G", aliases: ["pantene", "pantenebrasil"] },
  { id: "headshoulders", label: "Head & Shoulders", grupo: "P&G", aliases: ["headshoulders", "headandshoulders"] },
  { id: "aussie", label: "Aussie", grupo: "P&G", aliases: ["aussie"] },
  { id: "dove", label: "Dove", grupo: "Unilever", aliases: ["dove", "dovebrasil"] },
  { id: "tresemme", label: "TRESemmé", grupo: "Unilever", aliases: ["tresemme", "tresemmebrasil"] },
  { id: "seda", label: "Seda", grupo: "Unilever", aliases: ["seda", "sedabrasil"] },
  { id: "clear", label: "Clear", grupo: "Unilever", aliases: ["clear", "clearbrasil"] },
  { id: "monange", label: "Monange", grupo: "Coty", aliases: ["monange"] },
  { id: "salonline", label: "Salon Line", grupo: "Salon Line", aliases: ["salonline", "salonlinebrasil"] },
  { id: "skala", label: "Skala", grupo: "Skala", aliases: ["skala", "skalacosmeticos"] },
  { id: "novex", label: "Novex", grupo: "Embelleze", aliases: ["novex", "embelleze"] },
  { id: "truss", label: "Truss", grupo: "Truss", aliases: ["truss", "trussprofessional"] },
  { id: "brae", label: "Braé", grupo: "Braé", aliases: ["brae", "braecosmetics"] },
  { id: "wella", label: "Wella", grupo: "Wella", aliases: ["wella", "wellaprofessionals"] },
  { id: "sebastian", label: "Sebastian Professional", grupo: "Wella", aliases: ["sebastian", "sebastianprofessional"] },
  { id: "bioextratus", label: "Bio Extratus", grupo: "Bio Extratus", aliases: ["bioextratus"] },
  { id: "foreverliss", label: "Forever Liss", grupo: "Forever Liss", aliases: ["foreverliss"] },
  { id: "widicare", label: "Widi Care", grupo: "Widi Care", aliases: ["widicare"] },
  { id: "inoar", label: "Inoar", grupo: "Inoar", aliases: ["inoar"] },
  { id: "lola", label: "Lola Cosmetics", grupo: "Lola", aliases: ["lola", "lolacosmetics", "lolafromrio"] },
  { id: "haskell", label: "Haskell", grupo: "Haskell", aliases: ["haskell"] },
  { id: "natura", label: "Natura (capilar)", grupo: "Natura &Co", aliases: ["natura", "naturalumina", "naturatododia"] },
  { id: "boticario", label: "O Boticário (capilar)", grupo: "Boticário", aliases: ["oboticario", "boticario", "nativaspa"] },
  { id: "eudora", label: "Eudora (Siàge)", grupo: "Boticário", aliases: ["eudora", "siage"] },
  { id: "amend", label: "Amend", grupo: "Amend", aliases: ["amend"] },
  { id: "keune", label: "Keune", grupo: "Keune", aliases: ["keune"] },
];

// Marcas do grupo L'Oréal — saturação "interna", reportada à parte e SEM pontos.
//
// A lista era de seis e cobria o capilar, que é o território do briefing. Só que a
// `brand_history` de uma creator de beleza traz o grupo inteiro: a base tem Maybelline,
// Lancôme, CeraVe, La Roche-Posay e SkinCeuticals a aparecer como marcas quaisquer, e o
// painel de marcas da ficha dizia "rival: não" a uma publi que é da própria casa. Como
// interna não pontua (ver saturacaoConcorrentes), acrescentar aqui NÃO mexe em nível de
// saturação, score nem classe — muda o que se REPORTA.
//
// Licenças de perfumaria e maquilhagem de luxo (YSL, Armani, Valentino, Prada) entram só
// na forma "… Beauty/Beauté": a casa de moda não é da L'Oréal, a linha de beleza é. Um
// post sobre um vestido Prada não é uma colaboração com o grupo.
const INTERNAS_LOREAL = [
  { id: "elseve", label: "L'Oréal Paris / Elseve", grupo: "L'Oréal", aliases: ["lorealparis", "loreal", "elseve", "lorealpariselseve", "elsevebrasil", "elvive"] },
  { id: "garnier", label: "Garnier (Fructis)", grupo: "L'Oréal", aliases: ["garnier", "garnierbrasil", "fructis"] },
  { id: "kerastase", label: "Kérastase", grupo: "L'Oréal", aliases: ["kerastase"] },
  { id: "redken", label: "Redken", grupo: "L'Oréal", aliases: ["redken", "redkenbrasil"] },
  { id: "lorealpro", label: "L'Oréal Professionnel", grupo: "L'Oréal", aliases: ["lorealprofessionnel", "lorealpro", "lorealprofissional"] },
  { id: "matrix", label: "Matrix", grupo: "L'Oréal", aliases: ["matrixprofessional", "matrixbrasil"] },
  { id: "mizani", label: "Mizani", grupo: "L'Oréal", aliases: ["mizani"] },
  { id: "pureology", label: "Pureology", grupo: "L'Oréal", aliases: ["pureology"] },
  { id: "niely", label: "Niely (Gold)", grupo: "L'Oréal", aliases: ["niely", "nielygold", "nielycosmeticos"] },
  { id: "maybelline", label: "Maybelline", grupo: "L'Oréal", aliases: ["maybelline", "maybellinenewyork", "maybellineny", "maybellinebrasil"] },
  { id: "colorama", label: "Colorama", grupo: "L'Oréal", aliases: ["colorama"] },
  { id: "nyx", label: "NYX Professional Makeup", grupo: "L'Oréal", aliases: ["nyx", "nyxcosmetics", "nyxprofessionalmakeup"] },
  { id: "essie", label: "Essie", grupo: "L'Oréal", aliases: ["essie"] },
  { id: "vichy", label: "Vichy (Dercos)", grupo: "L'Oréal", aliases: ["vichy", "dercos"] },
  { id: "larocheposay", label: "La Roche-Posay", grupo: "L'Oréal", aliases: ["larocheposay", "larocheposaybrasil"] },
  { id: "cerave", label: "CeraVe", grupo: "L'Oréal", aliases: ["cerave", "ceravebrasil"] },
  { id: "skinceuticals", label: "SkinCeuticals", grupo: "L'Oréal", aliases: ["skinceuticals"] },
  { id: "dermablend", label: "Dermablend", grupo: "L'Oréal", aliases: ["dermablend"] },
  { id: "lancome", label: "Lancôme", grupo: "L'Oréal", aliases: ["lancome", "lancomebrasil"] },
  { id: "kiehls", label: "Kiehl's", grupo: "L'Oréal", aliases: ["kiehls"] },
  { id: "biotherm", label: "Biotherm", grupo: "L'Oréal", aliases: ["biotherm"] },
  { id: "shuuemura", label: "Shu Uemura", grupo: "L'Oréal", aliases: ["shuuemura"] },
  { id: "urbandecay", label: "Urban Decay", grupo: "L'Oréal", aliases: ["urbandecay"] },
  { id: "itcosmetics", label: "IT Cosmetics", grupo: "L'Oréal", aliases: ["itcosmetics"] },
  { id: "luxebeauty", label: "L'Oréal Luxe (licenças de beleza)", grupo: "L'Oréal", aliases: ["yslbeauty", "yslbeaute", "yvessaintlaurentbeaute", "yvessaintlaurentbeauty", "armanibeauty", "giorgioarmanibeauty", "valentinobeauty", "valentinobeaute", "pradabeauty", "mugler", "azzaro", "viktorrolf", "maisonmargielafragrances"] },
  { id: "dermaclub", label: "Dermaclub (programa L'Oréal)", grupo: "L'Oréal", aliases: ["dermaclub"] },
];

const porAlias = new Map();
for (const lista of [CONCORRENTES, INTERNAS_LOREAL]) {
  const interna = lista === INTERNAS_LOREAL;
  for (const m of lista) for (const a of m.aliases) porAlias.set(a, { ...m, interna });
}

/**
 * Classifica um rótulo de marca do brand_history.
 *
 * A igualdade exata não chegava. A `brand_history` é escrita pela IA a partir das
 * legendas, e o que lá aparece é o nome comercial completo: "L'Oréal Paris - Elseve
 * Colágeno Lifter", "L'Oréal Paris Brasil", "Cicaplast (La Roche-Posay)", "Maybelline NY
 * Brasil". Nenhum destes casava, e o resultado era uma publi da própria casa a passar por
 * marca desconhecida — 15 grafias diferentes de L'Oréal na base, das quais 5 falhavam.
 *
 * Por PREFIXO DE PALAVRAS, e não por substring: o nome da marca vem à cabeça do rótulo,
 * e comparar palavras inteiras evita que "amend" case dentro de "amendoim" ou "clear"
 * dentro de "clearblue". Do prefixo mais longo para o mais curto, para que
 * "L'Oréal Professionnel" não caia em "L'Oréal Paris".
 *
 * O conteúdo entre parênteses é testado à parte, porque a outra forma que a IA usa é
 * "Produto (Marca)" — e `key()` deita os parênteses fora.
 *
 * Fica de fora, de propósito, a marca no FIM do rótulo ("Esmalte Colorama"): apanhava
 * dois rótulos na base inteira e abria a porta a casar pela última palavra, que é onde
 * moram "Brasil", "Beauty" e "Cosméticos".
 *
 * @returns {{id,label,grupo,interna:boolean}|null} null se não é concorrente nem interna
 */
const MAX_TOKENS = 4;
const palavras = (label) => norm(label).split(/[^a-z0-9]+/).filter(Boolean);

function porPrefixo(tokens) {
  for (let n = Math.min(tokens.length, MAX_TOKENS); n >= 1; n--) {
    const hit = porAlias.get(tokens.slice(0, n).join(""));
    if (hit) return hit;
  }
  return null;
}

export function marcaConcorrente(label) {
  if (!label) return null;
  const direto = porAlias.get(key(canonicalBrandLabel(label))) || porAlias.get(key(label));
  if (direto) return direto;

  const semParentesis = String(label).replace(/\([^)]*\)/g, " ");
  const dentro = [...String(label).matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  for (const cand of [semParentesis, ...dentro]) {
    const hit = porPrefixo(palavras(cand));
    if (hit) return hit;
  }
  return null;
}

export { CONCORRENTES, INTERNAS_LOREAL };
export const norml = norm; // reexport de conveniência p/ consumidores do módulo
