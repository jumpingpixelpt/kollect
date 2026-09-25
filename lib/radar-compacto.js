// Base do Creators Hub em forma compacta — o que fica gravado em `radar_cache` (22/09/2026).
//
// Porquê: medido em produção, o Hub levava 6–7,8 s na primeira visita de cada instância da
// Vercel, porque cada instância fria montava a base inteira — RPC radar_base(false), ~10 MB
// de JSON com as séries de snapshots e as médias de vídeos, ~0,9 s de SQL — e o cache era só
// de processo. O modo light da RPC não resolvia: mede 7,6 MB e 0,7 s (a leaderboard e o
// brand_history são o grosso, não as séries). E o Data Cache da Vercel (unstable_cache) não
// guarda itens acima de 2 MB. Então a montagem passa a correr uma vez, fora do pedido, e o
// resultado — só as linhas já agrupadas por pessoa, com os campos que a lista desenha, filtra,
// ordena e procura — fica numa linha de `radar_cache`, que qualquer instância lê numa ida.
//
// Módulo puro (imports relativos), para o script de medição e os testes o usarem sem Next.
// As REGRAS continuam em lib/radar-base.js: isto só escolhe campos, não recalcula nada.

// Sobe quando o formato das linhas mudar: uma linha gravada com outro formato é ignorada
// e remontada, em vez de chegar à lista com campos em falta.
export const RADAR_CACHE_VERSAO = 1;

// Campos que a lista realmente desenha. O resto das linhas do `leaderboard`
// (tubular_id, momentum/gravity/authority, person_key…) e os índices de filtro
// (brand_keys, subnicho_keys, formato_keys, _s) só interessam ao servidor:
// mandá-los era 30% do payload de cada fatia (medido: 85 kB → 59 kB por 48 cards).
// `fc` (forecast) e `classification` saíram a 22/09/2026: nenhum componente do Hub os lia
// (nem o card, nem a tabela, nem a ordenação), e o forecast precisa das séries inteiras.
export function slimRow(c) {
  return {
    // sem avatar_url (22/09/2026): o Hub desenha sempre a foto por id (lib/avatar-src.js pede
    // /api/thumb?avatar=<id>, e é o proxy que recorre ao avatar_url da base) — o URL assinado
    // do CDN, ~420 caracteres por creator, era um quarto da base em cache e nunca era lido
    id: c.id, name: c.name, handle: c.handle, platform: c.platform,
    niche: c.niche, category: c.category, top_nicho: c.top_nicho, top_subnicho: c.top_subnicho,
    territorio: c.territorio,
    // kol_nota/kol_estado vêm da view (escalares) e são o que o card desenha; o kol_index do
    // screening deixou de ir para o cliente porque nada lá o usa desde que o card mudou de régua
    total: c.total, kol_nota: c.kol_nota, kol_estado: c.kol_estado, classe: c.classe, is_kol: c.is_kol,
    is_rising_star: c.is_rising_star, janela_aberta: c.janela_aberta, growth_30d: c.growth_30d,
    followers: c.followers, followers_combined: c.followers_combined,
    accounts: c.accounts, cache_per_video: c.cache_per_video,
    eng_per_post: c.eng_per_post, views_per_post: c.views_per_post, avg_views: c.avg_views,
    camp: c.camp ?? null,
    // pedido de 03/09: o cartão mostra a frase da bio e a taxa de engajamento (engajamentos ÷
    // views, lib/engagement.js — a do último snapshot que a tem). A bio são ~100 caracteres por
    // creator, 5 kB por fatia de 48; o cartão corta-a a duas linhas.
    bio: c.bio ?? null, eng_rate: c.eng_rate ?? null,
    // só nos acertos da busca por tema: a semelhança do conteúdo com a consulta. O card
    // marca-os — entraram pelo conteúdo, não pelo nome, e a lista tem de dizer isso.
    ...(c.tema_sim != null ? { tema_sim: c.tema_sim } : {}),
  };
}

// Linha guardada = o que vai para o cliente + os índices que só o servidor usa para filtrar
// (marca, Creator's Topic, formato) e procurar (nome/@, categoria, @ de cada conta).
// Tudo o que lib/radar-data.js e lib/list-filters.js leem de uma linha tem de estar aqui —
// tests/radar-compacto.test.mjs confere filtro a filtro e chave de ordenação a chave.
//
// As chaves de marca / sub-nicho / formato gravam-se como POSIÇÕES nas listas de opções
// (brandOpts/subnichoOpts/formatoOpts, que já têm todas as chaves — saem da mesma recolha em
// lib/radar-base.js): o texto das chaves era 1,2 MB da base. baseDoPayload devolve-as a texto,
// portanto os filtros de lib/radar-data.js continuam a comparar as mesmas strings.
export function compactRow(c, idx = null) {
  const cod = (keys, mapa) => (mapa ? (keys ?? []).map((k) => mapa.get(k) ?? k) : (keys ?? []));
  return {
    ...slimRow(c),
    brand_keys: cod(c.brand_keys, idx?.brand),
    subnicho_keys: cod(c.subnicho_keys, idx?.subnicho),
    formato_keys: cod(c.formato_keys, idx?.formato),
    _s: c._s ?? "",
    _c: c._c ?? "",
    _hs: c._hs ?? [],
  };
}

const posicoes = (opts) => new Map((opts ?? []).map(([k], i) => [k, i]));

// Base montada (lib/radar-base.js) → payload gravável. A ordem das linhas é a da montagem
// (elegíveis pela nota do briefing, depois Radar Score) e é preservada tal e qual.
export function compactarBase(base) {
  const idx = { brand: posicoes(base.brandOpts), subnicho: posicoes(base.subnichoOpts), formato: posicoes(base.formatoOpts) };
  return {
    v: RADAR_CACHE_VERSAO,
    rows: (base.allUnfiltered ?? []).map((c) => compactRow(c, idx)),
    brandOpts: base.brandOpts ?? [],
    subnichoOpts: base.subnichoOpts ?? [],
    subnichoTopOpts: base.subnichoTopOpts ?? [],
    formatoOpts: base.formatoOpts ?? [],
  };
}

// Payload gravado → a forma que radarData espera (`allUnfiltered` + opções dos filtros), com
// as chaves de volta a texto. null quando o formato não é o desta versão do código: quem lê
// remonta a partir da RPC.
export function baseDoPayload(p) {
  if (!p || p.v !== RADAR_CACHE_VERSAO || !Array.isArray(p.rows)) return null;
  const chaves = (opts) => (opts ?? []).map(([k]) => k);
  const brand = chaves(p.brandOpts), subnicho = chaves(p.subnichoOpts), formato = chaves(p.formatoOpts);
  const dec = (keys, lista) => (keys ?? []).map((k) => (typeof k === "number" ? lista[k] : k));
  const rows = p.rows.map((r) => ({
    ...r,
    brand_keys: dec(r.brand_keys, brand),
    subnicho_keys: dec(r.subnicho_keys, subnicho),
    formato_keys: dec(r.formato_keys, formato),
  }));
  return {
    allUnfiltered: rows,
    brandOpts: p.brandOpts ?? [],
    subnichoOpts: p.subnichoOpts ?? [],
    subnichoTopOpts: p.subnichoTopOpts ?? [],
    formatoOpts: p.formatoOpts ?? [],
  };
}
