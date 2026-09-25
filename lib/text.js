// Normalização de texto para busca por nome.
//
// Metade dos creators do TikTok/Instagram escreve o nome em unicode decorativo
// (𝑵𝑨𝑫𝑰𝑵𝑬 𝑪𝑯𝑨𝑮𝑨𝑺, 𝘔𝘢𝘳𝘪𝘢𝘯𝘯𝘢, ＦＵＬＬＷＩＤＴＨ) e o resto usa acentos. Nem o
// toLowerCase() do JS nem o ilike do Postgres desfazem qualquer um dos dois: quem
// escrevia "Nadine Chagas" na busca recebia "nenhum creator nesse recorte" com ela
// na base. NFKD resolve os dois casos — decompõe as variantes matemáticas/fullwidth
// em ASCII e separa os acentos em combining marks, que a seguir removemos.
//
// O lado do servidor tem de dobrar igual: a coluna gerada `prospects.name_norm`
// (migração `prospects_name_norm_busca`) aplica a mesma regra em SQL, e é contra ela
// que as buscas por nome em /descobertas e no casting de campanha correm.
export const fold = (s) => (s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
