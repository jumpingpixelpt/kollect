// Montagem da lista do radar — partilhada entre a home (cockpit, modo light),
// a página /creators (SSR da 1ª fatia) e /api/creators-list (fatias do scroll).
// Extraída de app/(app)/page.js quando a lista migrou para /creators: uma única
// implementação para enriquecer (classe, nicho, forecast, eng/post), agrupar por
// person_key, filtrar pelos params de URL e ordenar por kol_nota/total.
//
// opts.light: salta snapshots e vídeos (as duas tabelas mais pesadas) — chega para
// contagens, classes e oportunidades da home; classification/fc/eng ficam null.
import { supabaseServer as supabase } from "@/lib/supabase";
import { fold } from "@/lib/text";
import { assembleRadarBase } from "@/lib/radar-base";
import { fetchRadarSource } from "@/lib/radar-source";
import { inBand, isBand, inTier, isTier, matchClassificacao, SORT_KEYS, bySort } from "@/lib/list-filters";
import { buscaPorTema } from "@/lib/busca-tema";
import { baseHub } from "@/lib/radar-cache";

// Paginação (tecto de 1000 linhas do Supabase) — mora em lib/fetch-all.js desde que o
// cron de coleta passou a precisar dela sem arrastar este módulo. Reexportada para os
// call sites que já a importavam daqui.
export { fetchAllRows } from "@/lib/fetch-all";
import { fetchAllRows } from "@/lib/fetch-all";
import { soMeus } from "@/lib/auth-server";

// Cache de processo com TTL. A montagem (2 tabelas grandes + JSONs por creator) é
// idêntica para qualquer recorte — só os filtros mudam. Sem isto, CADA fatia do
// scroll infinito de /creators remontava a base inteira (medido: 3,6 s por fatia).
// Guardamos a Promise, não o resultado: chamadas simultâneas com cache frio
// partilham a mesma query em vez de dispararem N iguais.
//
// Com TTL seco, o primeiro pedido depois de expirar pagava os ~3 s da montagem —
// e quem escreve na busca faz um pedido por palavra, portanto calhava-lhe a ele.
// Passado o TTL a cópia em memória continua a servir e a montagem nova corre por
// trás (stale-while-revalidate): só o primeiro pedido de cada instância espera.
// Passados STALE_MS sem ninguém aparecer, a cópia é velha de mais para servir e
// o pedido seguinte remonta à séria.
//
// Desde 22/09/2026 a base completa vem já montada da tabela radar_cache (lib/radar-cache.js),
// que tem a sua própria frescura (≤ 8 min, cron de 5 em 5). Este cache de processo fica por
// cima só para não reler ~5 MB a cada fatia do scroll; a janela de stale encolheu de 5 para
// 2 min para o atraso total continuar dentro dos ~10 min combinados.
const TTL_MS = 60_000;
const STALE_MS = 2 * 60_000;
const _cache = new Map(); // "light" | "full" → { at, promise, revalidando }

// Invalidação para quem MUTA a base (creator-delete): sem isto, apagar um creator e voltar à
// lista mostrava o fantasma por até TTL+SWR — a base tinha mudado e o cache não sabia.
// Nota de alcance: em serverless isto limpa só a instância local; o caminho que garante a
// leitura fresca ao operador é o `fresh` abaixo, pedido pelo cliente após a mutação.
export function invalidateRadarCache() { _cache.clear(); }

function baseData(light, fresh = false) {
  const k = light ? "light" : "full";
  const hit = fresh ? null : _cache.get(k);
  const idade = hit ? Date.now() - hit.at : Infinity;

  if (hit && idade < TTL_MS) return hit.promise;

  if (hit && idade < STALE_MS) {
    if (!hit.revalidando) {
      hit.revalidando = true;
      buildBase(light)
        .then((novo) => _cache.set(k, { at: Date.now(), promise: Promise.resolve(novo) }))
        .catch(() => { hit.revalidando = false; }); // falhou: a próxima tenta outra vez
    }
    return hit.promise;
  }

  const promise = buildBase(light, fresh).catch((e) => { _cache.delete(k); throw e; });
  _cache.set(k, { at: Date.now(), promise });
  return promise;
}

export async function radarData(sp = {}, opts = {}) {
  const { p: platform, n: cat, l: logic, c: campaign, cs: campStatus, b: brand, sn: subnicho, ft: formato } = sp;
  // A lista de briefings NÃO pode viver na montagem cacheada: o _cache é por "light|full"
  // e partilhado entre pedidos, portanto a lista do primeiro utilizador seria servida a
  // todos os outros. Briefings são individuais — logo, uma leitura por pedido, e só para
  // quem a pede (passa userId): quem desenha a barra de filtros. O scroll infinito de
  // /creators chama isto uma vez por fatia e não desenha filtro nenhum.
  const [base, campaigns] = await Promise.all([
    baseData(!!opts.light, !!opts.fresh),
    opts.userId
      ? soMeus(supabase.from("campaigns").select("id, name"), opts.userId, !!opts.isAdmin)
          .order("created_at", { ascending: false }).then((r) => r.data || [])
      : Promise.resolve([]),
  ]);

  let campRows = null;
  if (campaign) {
    const { data } = await supabase.from("campaign_creators")
      .select("creator_id, status, match_score").eq("campaign_id", campaign).not("creator_id", "is", null);
    campRows = {};
    for (const r of data ?? []) campRows[r.creator_id] = { status: r.status, match: r.match_score };
  }

  // ── filtros da barra (baratos: só percorrem a base já montada) ──
  let list = base.allUnfiltered;
  if (["tiktok", "instagram", "youtube", "x"].includes(platform)) list = list.filter((c) => c.platform === platform);
  if (cat) list = list.filter((c) => c.territorio === cat);
  // "Só KOL" / "KOL + Pool" (lib/list-filters.js); as classes do §8 e "janela" continuam a
  // valer por URL, para os atalhos antigos não caírem em "nenhum creator"
  if (logic) list = list.filter((c) => matchClassificacao(c, logic));
  if (brand) list = list.filter((c) => (c.brand_keys || []).includes(brand));
  if (subnicho) list = list.filter((c) => (c.subnicho_keys || []).includes(subnicho));
  if (formato) list = list.filter((c) => (c.formato_keys || []).includes(formato));
  if (isBand(sp.fw)) list = list.filter((c) => inBand(c.followers_combined ?? c.followers, sp.fw));
  // Tier (set/2026): pela maior conta isolada da pessoa, não pelo alcance somado
  if (isTier(sp.tier)) list = list.filter((c) => inTier(c, sp.tier));

  // ── busca por texto: nome, @handle, categoria ──
  // Eram filtros de cliente sobre a fatia já carregada: com 48 de 1.765 em memória,
  // procurar um nome que estivesse na posição 900 não devolvia nada e o scroll
  // infinito ficava a puxar páginas atrás de um resultado que ninguém filtrava.
  // Correm aqui, sobre a base inteira, e o `total` devolvido já é o do recorte.
  // `_c` é a categoria (nicho e sub-nicho da IA, nicho da ficha, território): "cabelo
  // cacheado" acha quem faz cabelo cacheado, não só quem se chama assim.
  const recorte = list;
  const termos = searchTerms(sp.q);
  for (const t of termos) list = list.filter((c) => (c._s || "").includes(t) || (c._c || "").includes(t));

  // ── busca por tema (Enter / botão Buscar): o conteúdo, não o nome ──
  // União com os acertos de texto, nunca substituição: quem já estava por nome fica à
  // cabeça, por relevância, e atrás vêm, por semelhança, os creators cujo conteúdo indexado
  // fala do tema (lib/busca-tema.js). Só corre a pedido (tema=1): custa um embedding e uma
  // passagem pelo pgvector. Os filtros da barra valem para os dois lados da união.
  let tema = null;
  let temaUniao = false;
  if (termos.length && sp.tema === "1") {
    const r = await buscaPorTema(String(sp.q));
    if (r.erro) tema = { n: 0, erro: r.erro };
    else {
      const jaEsta = new Set(list.map((c) => c.id));
      // a pessoa pode ter conteúdo indexado em qualquer das suas contas
      const sim = (c) => Math.max(-1, ...[c.id, ...(c.accounts || []).map((a) => a.id)].map((id) => r.porCreator.get(id) ?? -1));
      const extra = recorte
        .filter((c) => !jaEsta.has(c.id))
        .map((c) => ({ ...c, tema_sim: sim(c) }))
        .filter((c) => c.tema_sim >= 0)
        .sort((a, b) => b.tema_sim - a.tema_sim);
      list = [...porRelevancia(list, termos), ...extra];
      tema = { n: extra.length };
      temaUniao = true;
    }
  }

  if (campRows) {
    list = list
      .map((c) => {
        const hit = c.accounts.map((a) => campRows[a.id]).find(Boolean) || campRows[c.id];
        return hit ? { ...c, camp: hit } : null;
      })
      .filter(Boolean)
      .filter((c) => !campStatus || c.camp.status === campStatus)
      .sort((a, b) => (b.camp.match ?? 0) - (a.camp.match ?? 0));
  }

  // ordenação por coluna da vista em lista — sobre o recorte todo, não sobre o
  // que já desceu para o browser (senão o "↓ Seguidores" ordenava 48 de 1.765)
  if (SORT_KEYS.includes(sp.sort)) list = [...list].sort(bySort(sp.sort, sp.dir === "asc" ? "asc" : "desc"));
  else if (termos.length && !temaUniao) list = porRelevancia(list, termos); // com tema, a união já vem ordenada

  return { ...base, campaigns, all: list, tema };
}

// "  @Nadine  Chagas " → ["nadine", "chagas"] — todos os termos têm de bater, em
// qualquer ordem. `fold` desfaz acentos e o unicode decorativo dos nomes (𝑵𝑨𝑫𝑰𝑵𝑬),
// a mesma normalização com que `_s` foi construído na montagem da base.
function searchTerms(q) {
  return fold(String(q ?? "").trim().replace(/^@/, "")).split(/\s+/).filter(Boolean);
}

// Sem isto a busca devolvia pela ordem da base, e "rui" punha a Bianca Da**rui**z e o
// Mago dos R**ui**vos à frente do Rui Guedes — o resultado certo estava lá, mas
// não à vista. Escala: @ exato > @ que começa pelo termo > o termo como palavra
// inteira no nome > o termo a começar uma palavra > o termo no meio de uma > o termo
// só na categoria (nicho, sub-nicho, território). Empates mantêm a ordem da base
// (Score KOL, e Radar nos inelegíveis), porque o sort do JS é estável.
function porRelevancia(list, termos) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const palavraInteira = termos.map((t) => new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`));
  const inicioDePalavra = termos.map((t) => new RegExp(`(^|[^a-z0-9])${esc(t)}`));
  const peso = (c) => {
    let s = 0;
    const hs = c._hs || [];
    const texto = c._s || "";
    for (let i = 0; i < termos.length; i++) {
      const t = termos[i];
      if (hs.includes(t)) s += 100;
      else if (hs.some((h) => h.startsWith(t))) s += 40;
      else if (palavraInteira[i].test(texto)) s += 20;
      else if (inicioDePalavra[i].test(texto)) s += 10;
      else if (texto.includes(t)) s += 3;
      else s += 1; // só na categoria
    }
    return s;
  };
  return list.map((c) => [peso(c), c]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

// slimRow (campos que vão para o cliente) mora em lib/radar-compacto.js desde 22/09/2026 —
// é o mesmo recorte que a base partilhada grava. Reexportado para os call sites de sempre.
export { slimRow } from "@/lib/radar-compacto";

async function buildBase(light, fresh = false) {
  // Base completa (a do Hub): vem da tabela radar_cache, partilhada entre instâncias — ver
  // lib/radar-cache.js. Antes cada instância fria montava-a pela RPC (~10 MB, 6–7,8 s na
  // primeira visita medidos em produção). `fresh` salta a tabela e remonta da base viva.
  if (!light) return baseHub({ fresh });
  // Modo light (sem séries nem vídeos): continua a montar pela RPC.
  // Uma leitura consistente, sem repetir a view inteira a cada página de 1000.
  // A RPC agrega os arrays num único objeto e elimina evidências/peças que a lista
  // não usa. Falhas propagam: uma consulta incompleta nunca vira cache vazio.
  return assembleRadarBase(await fetchRadarSource(supabase, light), { light });
}
