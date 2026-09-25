/**
 * Territórios de descoberta — beauty · lifestyle · health.
 *
 * O critério de aceitação de 15/08 (docs/discovery-plano-kollect-loreal.md §7) pede "base
 * mapeada: beauty + lifestyle + saúde". Até jul/2026 o conceito de território estava
 * espalhado por constantes soltas — TERMOS em /api/discover, TERMOS_AI/BIO/CAP em
 * /api/ic-sweep, SEED_TAGS/SEED_KW em /api/discover-caption, e o literal `23` do género
 * Beauty da Tubular em treze sítios. Alargar para três territórios nesse formato seria
 * multiplicar o problema por três. Passa a haver um registo declarativo, no molde
 * documentado do lib/clients.js.
 *
 * PARA ACRESCENTAR UM TERRITÓRIO:
 *   1. acrescentar a entrada aqui, com generos + keywords + hashtags + banda de seguidores;
 *   2. confirmar que os `generos` existem (ver a tabela abaixo — foram mapeados
 *      empiricamente, a Tubular não os documenta);
 *   3. nada mais: /api/discover-tubular e o botão de /descobertas leem daqui.
 *
 * GÉNEROS DA TUBULAR (medidos a 28/07/2026 — id, nome, e volume de vídeos BR nos últimos
 * 30 dias em TikTok+Instagram, que é o tamanho real do caldo de cada um):
 *
 *    2  Travel                        28.015
 *    4  Sports                             —
 *    7  People & Blogs               664.664
 *   15  Food & Drink                 239.321
 *   16  Fashion & Style              444.815
 *   19  Health, Fitness & Self Help    42.258
 *   21  Home & DIY                   288.734
 *   23  Beauty                       352.844
 *   32  Family & Parenting            16.357
 *   36  Entertainment                      —
 *   37  General Interest                   —
 *
 * NOTA SOBRE "LIFESTYLE": a Tubular NÃO tem género Lifestyle. O que há é um cacho que,
 * somado, dá 1,68 M de vídeos/30d — três vezes o beauty inteiro e maioritariamente
 * irrelevante para o cliente. Home & DIY, Food, Travel e Family ficam de fora até haver
 * pedido explícito.
 *
 * O `exige_keyword` não é preferência, é necessidade medida (28/07): varrendo 16+7 sem
 * termo, só 28% do lote cai na faixa de seguidores — contra 58% no beauty — e o que sai é
 * "No Controle Racing" e "AGORA EU SEI!". O género 7 (People & Blogs) é o saco de tudo. Com
 * `search` no include_filter do video.search, o género 16 desce de 43.311 para 418 vídeos e
 * o que vem é do território.
 *
 * `search` é a ÚNICA chave de texto que o video.search aceita: video_title, keywords,
 * video_keywords e video_themes devolvem todas 400 invalid_post_data.
 *
 * NOTA SOBRE "HEALTH": a fronteira exacta depende das perguntas B4 e B5 de
 * docs/acoes-cliente-kollect.md ("barba e grooming entra?", "dermatologistas e
 * tricologistas entram como recomendáveis?"), sem resposta à data. Enquanto não houver
 * resposta, o género 19 é restringido por keyword ao núcleo capilar/derma — que é o Plano B
 * escrito nesse documento. Alargar é acrescentar keywords, não mexer em código.
 */

export const TERRITORIOS = {
  beauty: {
    label: "Beauty",
    generos: [23],
    // o género 23 já é o território; as keywords servem o cruzamento por legenda no Apify
    exige_keyword: false,
    keywords: [
      "maquiagem", "skincare", "resenha de maquiagem", "rotina de skincare", "cabelo",
      "beleza", "perfume", "unhas", "cílios", "sobrancelhas", "pele oleosa", "anti-idade",
      "cabelo cacheado", "cabelo loiro", "base para pele", "batom",
    ],
    hashtags: [
      "maquiagem", "skincare", "resenhademaquiagem", "rotinadeskincare", "dicasdebeleza",
      "cabelocacheado", "peleoleosa", "makeup", "unhasdecoradas",
    ],
    faixa: { min: 3000, max: 500000 },
  },

  health: {
    label: "Saúde e bem-estar",
    // O GÉNERO É 23, NÃO 19 — medido a 29/07.
    //
    // Este território estava vazio POR CONSTRUÇÃO: uma varredura de `todos` devolveu-lhe
    // zero descobertos, e a sonda directa mostrou porquê. As seis primeiras keywords,
    // cruzadas com o género 19 (Health, Fitness & Self Help) e com o 23 (Beauty), em BR,
    // TikTok, 30 dias, vídeos com mais de 20 mil views:
    //
    //   keyword               g19    g23
    //   queda de cabelo         0     20
    //   queda capilar           0     20
    //   afinamento capilar      0      0
    //   cabelo fino             0      8
    //   cabelo ralo             0      5
    //   calvície                0     20
    //
    // A Tubular classifica o creator brasileiro de queda capilar como BEAUTY. O género 19
    // é ginásio, nutrição e auto-ajuda — o conteúdo existe (sem keyword devolve resultados),
    // mas não é este. Mantém-se na lista porque cobrir os dois num só `creator_genres` não
    // custa uma chamada a mais, e porque é onde cairia um nutricionista capilar.
    //
    // Isto NÃO responde às perguntas 3 e 4 da Onda 0 (barba/grooming entram? dermatologistas
    // são creators recomendáveis ou só referência?) — essas são de âmbito e continuam com o
    // cliente. O que se corrige aqui é factual: o género escolhido não continha o conteúdo
    // que as keywords descrevem.
    generos: [23, 19],
    exige_keyword: true,
    keywords: [
      "queda de cabelo", "queda capilar", "afinamento capilar", "cabelo fino", "cabelo ralo",
      "calvície", "minoxidil", "tricologia", "couro cabeludo", "dermatologia",
      "dermatologista", "saúde capilar", "pós parto cabelo", "alimentos para queda",
      "vitaminas para cabelo", "barba", "grooming masculino",
    ],
    hashtags: [
      "quedadecabelo", "quedacapilar", "cabelofino", "cabeloralo", "afinamentocapilar",
      "tricologia", "courocabeludo", "minoxidil", "saudecapilar",
    ],
    faixa: { min: 3000, max: 500000 },
  },

  lifestyle: {
    label: "Lifestyle",
    generos: [16, 7],
    // obrigatório: sem keyword, 16+7 devolvem 1,1 M de vídeos/30d de tudo e mais alguma coisa
    exige_keyword: true,
    keywords: [
      "rotina", "minha rotina", "autocuidado", "self care", "dia a dia", "get ready with me",
      "grwm", "moda", "look do dia", "estilo de vida", "organização", "bem-estar",
      "produtividade", "morar sozinha", "rotina matinal", "rotina noturna",
    ],
    hashtags: [
      "rotina", "autocuidado", "selfcare", "grwm", "lookdodia", "estilodevida",
      "rotinamatinal", "morarsozinha",
    ],
    faixa: { min: 3000, max: 500000 },
  },
};

export const CHAVES = Object.keys(TERRITORIOS);

/** Território válido, ou null. Usado por rotas e pelo botão da UI. */
export function territorio(chave) {
  return TERRITORIOS[chave] ?? null;
}

/** Todos os géneros de um território, ou de todos se `chave` for nula. */
export function generosDe(chave) {
  if (!chave) return [...new Set(CHAVES.flatMap((k) => TERRITORIOS[k].generos))];
  return TERRITORIOS[chave]?.generos ?? [];
}

/**
 * A que território pertence um género da Tubular. Um género pode servir mais que um
 * território no futuro; devolve o primeiro, que é o que se grava em `prospects.genre`.
 */
export function territorioDoGenero(generoId) {
  return CHAVES.find((k) => TERRITORIOS[k].generos.includes(Number(generoId))) ?? null;
}

/** Rotação estável para o cron: um território por dia, sem estado guardado. */
export function territorioDoDia(data = new Date()) {
  const dias = Math.floor(data.getTime() / 864e5);
  return CHAVES[dias % CHAVES.length];
}
