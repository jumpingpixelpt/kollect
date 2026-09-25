// Leituras pequenas para páginas de listas. Nunca cachear sessões ou resultados
// individuais aqui; o cliente Supabase continua a fazer fetch com no-store.
import { fetchAllRows } from "./fetch-all.js";
export const fetchPageRows = (build) => fetchAllRows(build, { strict: true });

// IDs em lotes curtos evitam URLs grandes; no máximo quatro consultas em paralelo.
// A query de cada lote também é paginada: 150 campanhas podem ter milhares de membros.
export async function fetchPageIds(build, ids) {
  const unique = [...new Set(ids.filter((id) => id != null))];
  const rows = [];
  for (let offset = 0; offset < unique.length; offset += 600) {
    const batches = [];
    for (let i = offset; i < Math.min(offset + 600, unique.length); i += 150) {
      const part = unique.slice(i, i + 150);
      batches.push(fetchPageRows(() => build(part)));
    }
    rows.push(...(await Promise.all(batches)).flat());
  }
  return rows;
}

export async function fetchPageCounts(db, { campaignIds = [], listIds = [], briefingIds = [] } = {}) {
  if (!campaignIds.length && !listIds.length && !briefingIds.length) return { campaigns: [], lists: [], briefings: [] };
  const { data, error } = await db.rpc("page_counts", {
    p_campaign_ids: campaignIds, p_list_ids: listIds, p_briefing_ids: briefingIds,
  });
  if (error || !data || !["campaigns", "lists", "briefings"].every((key) => Array.isArray(data[key]))) {
    throw new Error("Não foi possível carregar as contagens das listas");
  }
  return data;
}

export async function fetchCreatorLatestMetrics(db, creatorIds) {
  const ids = [...new Set(creatorIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await db.rpc("creator_latest_metrics", { p_creator_ids: ids });
  if (error || !Array.isArray(data)) throw new Error("Não foi possível carregar as métricas recentes");
  return data;
}

export async function fetchCampaignCreatorClasses(db, creatorIds) {
  const ids = [...new Set(creatorIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await db.rpc("campaign_creator_classes", { p_creator_ids: ids });
  if (error || !Array.isArray(data)) throw new Error("Não foi possível carregar as classes dos creators");
  return data;
}
