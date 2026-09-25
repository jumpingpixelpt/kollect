import { fetchPageIds, fetchCreatorLatestMetrics, fetchCampaignCreatorClasses } from "./page-data.js";

const CREATOR = [
  "id,name,handle,platform,followers,avatar_url,person_key",
  "screen_classe:kol_screen->>classe,screen_disaster:kol_screen->disaster",
  "niche_bucket:kol_screen->metricas->>niche_bucket,niche_density:kol_screen->metricas->niche_density",
  "eng_index:kol_screen->metricas->eng_index,consistency_pct:kol_screen->metricas->consistency_pct",
  "nichos:brand_history->nichos,sub_nichos:brand_history->sub_nichos",
  "mulheres_pct:audience->mulheres_pct,conversa_volume:conversa->volume,pct_duvidas:conversa->conteudo->pct_duvidas",
].join(",");
// retrato de 90 dias por rede/publi/total, pré-calculado (lib/metricas-rede.js; F1.7). A
// lista paginada (lib/casting-linhas.js) só precisa do `total` na linha fechada: o retrato
// por rede vai com o card aberto, que o pede à parte.
const CREATOR_COMPLETO = `${CREATOR},metricas_rede`;
const CREATOR_LEVE = `${CREATOR},metricas_rede_total:metricas_rede->total`;

export function campaignCreator(r) {
  return {
    id: r.id, name: r.name, handle: r.handle, platform: r.platform,
    followers: r.followers, avatar_url: r.avatar_url, person_key: r.person_key,
    kol_score: r.kol_score,
    kol_screen: { classe: r.screen_classe, disaster: r.screen_disaster, metricas: {
      niche_bucket: r.niche_bucket, niche_density: r.niche_density,
      eng_index: r.eng_index, consistency_pct: r.consistency_pct,
    } },
    brand_history: { nichos: r.nichos, sub_nichos: r.sub_nichos },
    audience: { mulheres_pct: r.mulheres_pct },
    conversa: { volume: r.conversa_volume, conteudo: { pct_duvidas: r.pct_duvidas } },
    metricas_rede: r.metricas_rede !== undefined ? (r.metricas_rede ?? null)
      : r.metricas_rede_total != null ? { total: r.metricas_rede_total } : null,
  };
}

// Chamada só depois de veCampanha: os IDs vêm do casting que o usuário pode abrir.
// Sem cache de campanha; leituras por IDs evitam os JSONs completos e URLs ilimitadas.
// `leve`: metricas_rede só com o ramo `total` (ver CREATOR_LEVE).
export async function fetchCampaignDetail(db, rows, { leve = false } = {}) {
  const creatorIds = (rows || []).map((r) => r.creator_id).filter(Boolean);
  const prospectIds = (rows || []).map((r) => r.prospect_id).filter(Boolean);
  const rowsPromise = fetchPageIds((ids) => db.from("creators").select(leve ? CREATOR_LEVE : CREATOR_COMPLETO).in("id", ids).order("id"), creatorIds);
  const creatorsPromise = Promise.all([rowsPromise, fetchCampaignCreatorClasses(db, creatorIds)]).then(([data, classes]) => {
    const porId = new Map(classes.map((c) => [c.id, c]));
    return data.map((c) => {
      if (!porId.has(c.id)) throw new Error("Não foi possível carregar todas as classes do casting");
      // A RPC mantém a presença original de cada ramo, mesmo sem classe: omitir o ramo
      // faria classeDe herdar indevidamente a classificação antiga do kol_screen.
      return campaignCreator({ ...c, kol_score: porId.get(c.id).kol_score });
    });
  });
  // As irmãs só dependem dos creators; não esperam pela leitura de métricas/prospects.
  const irmasPromise = rowsPromise.then((creators) => fetchPageIds((keys) => db.from("creators")
    .select("id,handle,platform,followers,person_key").in("person_key", keys).order("id"), creators.map((c) => c.person_key).filter(Boolean)));
  const [creators, prospects, promotedLink, metrics, irmasAll] = await Promise.all([
    creatorsPromise,
    fetchPageIds((ids) => db.from("prospects").select("tubular_id,name,thumbnail,followers,status").in("tubular_id", ids).order("tubular_id"), prospectIds),
    fetchPageIds((ids) => db.from("creators").select("tubular_id").in("tubular_id", ids).order("id"), prospectIds),
    fetchCreatorLatestMetrics(db, creatorIds),
    irmasPromise,
  ]);
  // O casting usa a última observação não-nula, mesmo quando a última linha só mede seguidores.
  const snapBy = Object.fromEntries(metrics.map((m) => [m.creator_id, { avg_views: m.last_avg_views, eng_rate: m.last_eng_rate }]));
  return { creators, prospects, promotedLink, snapBy, irmasAll };
}
