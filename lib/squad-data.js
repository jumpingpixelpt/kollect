import { fetchPageRows, fetchPageIds, fetchPageCounts, fetchCreatorLatestMetrics, fetchCampaignCreatorClasses } from "./page-data.js";
import { tagDaFicha } from "./casting.js";
import { squadProjection } from "./squad-metrics.js";
import { isSquadEmailConfigured } from "./squad-notifications.js";
import { CURADORIAS } from "./squad-curadoria.js";
export { CURADORIAS, CURADORIA_LABEL, NOTAS_MAX } from "./squad-curadoria.js";

const TERR_LABEL = { cabelo: "cabelo", maquiagem: "maquiagem", skincare: "skincare", unhas: "unhas", perfume: "perfume", cilios: "cílios", estetica: "estética" };

/** Território da pessoa: o nicho com maior % no brand_history, senão o bucket do KOL screen. */
export function territorioDe(nichos, bucket) {
  if (Array.isArray(nichos) && nichos.length) {
    const top = nichos.reduce((a, b) => (Number(b?.pct) > Number(a?.pct) ? b : a));
    const label = String(top?.nicho || "").split(/[&/|,]/)[0].trim();
    if (label) return Number.isFinite(Number(top.pct)) ? `${label} ${Math.round(Number(top.pct))}%` : label;
  }
  return bucket && bucket !== "outros" ? TERR_LABEL[bucket] || bucket : null;
}

/** Link público do perfil a partir da rede + @ (para o CSV e a defesa). */
export function perfilUrl(platform, handle) {
  const h = String(handle || "").replace(/^@+/, "").trim();
  if (!h) return null;
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "youtube") return `https://www.youtube.com/@${h}`;
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return null;
}

/** Iniciais de um utilizador da auth (nome nos metadados, senão a parte local do e-mail). */
export function iniciaisDe(user) {
  const nome = String(user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
  const base = nome || String(user?.email || "").split("@")[0];
  const partes = base.split(/[\s._-]+/).filter(Boolean);
  if (!partes.length) return null;
  const ini = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : partes[0].slice(0, 2);
  return ini.toUpperCase();
}

// Autores das notas e da defesa: só as iniciais chegam ao navegador (nunca o uuid nem o
// e-mail). Não há tabela de perfis — vem da auth admin API; sem ela (cliente anon, teste),
// fica sem autor em vez de falhar a página.
async function iniciaisPorId(db, ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const out = new Map();
  if (!unicos.length || typeof db?.auth?.admin?.getUserById !== "function") return out;
  await Promise.all(unicos.map(async (id) => {
    try {
      const { data } = await db.auth.admin.getUserById(id);
      const ini = iniciaisDe(data?.user);
      if (ini) out.set(id, ini);
    } catch { /* sem autor */ }
  }));
  return out;
}

// Uma única leitura alimenta a página e o retorno das alterações: os KPIs e a lista
// exibidos no navegador sempre correspondem ao mesmo conjunto de membros.
export async function fetchSquadSnapshot(db, id) {
  const [{ data: list, error }, items] = await Promise.all([
    db.from("lists").select("*").eq("id", id).maybeSingle(),
    fetchPageRows(() => db.from("list_creators").select("id, creator_id, prospect_id, status, match_score, curadoria, notas, notas_por, notas_em")
      .eq("list_id", id).order("created_at").order("id")),
  ]);
  if (error) throw new Error("Não foi possível carregar o squad.");
  if (!list) return null;
  const cIds = items.map((it) => it.creator_id).filter(Boolean);
  const pIds = items.filter((it) => !it.creator_id).map((it) => it.prospect_id).filter(Boolean);
  // Tabela do squad (feedback rodada 2, F2.2): comentários médios por peça vêm do volume
  // de conversa já calculado no creator (senão da média das peças dos 90 dias, metricas_rede);
  // território para o CSV e a defesa (F2.3/F2.4). Só fatias pequenas dos JSON.
  const [creators, prospects, classes, metrics, extras, campaign] = await Promise.all([
    fetchPageIds((ids) => db.from("leaderboard").select("id, name, handle, platform, followers").in("id", ids).order("id"), cIds),
    fetchPageIds((ids) => db.from("prospects").select("tubular_id, name, handle, platform, followers").in("tubular_id", ids).order("tubular_id"), pIds),
    fetchCampaignCreatorClasses(db, cIds),
    fetchCreatorLatestMetrics(db, cIds),
    fetchPageIds((ids) => db.from("creators").select("id, media_comentarios:conversa->volume->media_comentarios, comentarios_90d:metricas_rede->total->comentarios_media, nichos:brand_history->nichos, bucket:kol_screen->metricas->>niche_bucket").in("id", ids).order("id"), cIds).catch(() => []),
    // F2.5: o nome do briefing de origem, para o «← Voltar aos creators do briefing»
    list.campaign_id
      ? Promise.resolve(db.from("campaigns").select("id, name").eq("id", list.campaign_id).maybeSingle()).then((r) => r?.data ?? null).catch(() => null)
      : Promise.resolve(null),
  ]);
  const autores = await iniciaisPorId(db, [...items.map((it) => it.notas_por), list.defesa?.por]);
  const byId = (rows, key = "id") => new Map(rows.map((r) => [r[key], r]));
  const cBy = byId(creators), pBy = byId(prospects, "tubular_id");
  const classBy = byId(classes), metricBy = byId(metrics, "creator_id");
  const extraBy = byId(extras);
  const enriched = items.map(({ notas_por, ...it }) => {
    const metric = metricBy.get(it.creator_id);
    const extra = extraBy.get(it.creator_id);
    const conversa = Number(extra?.media_comentarios);
    const media90 = Number(extra?.comentarios_90d);
    const creator = cBy.get(it.creator_id) ?? null;
    const prospect = !it.creator_id ? pBy.get(it.prospect_id) ?? null : null;
    const profile = creator || prospect;
    return {
      ...it,
      curadoria: CURADORIAS.includes(it.curadoria) ? it.curadoria : "sugerida",
      notas: it.notas ?? null,
      notas_em: it.notas_em ?? null,
      notas_autor: autores.get(notas_por) ?? null,
      creator,
      prospect,
      tag: tagDaFicha(classBy.get(it.creator_id)),
      metrics: metric ? { avg_views: metric.avg_views, eng_rate: metric.eng_rate, captured_at: metric.captured_at } : null,
      media_comentarios: extra?.media_comentarios != null && Number.isFinite(conversa) ? conversa
        : extra?.comentarios_90d != null && Number.isFinite(media90) ? media90 : null,
      territorio: extra ? territorioDe(extra.nichos, extra.bucket) : null,
      perfil_url: perfilUrl(profile?.platform, profile?.handle),
    };
  });
  const defesa = list.defesa && typeof list.defesa.texto === "string"
    ? { texto: list.defesa.texto, fonte: list.defesa.fonte === "ia" ? "ia" : "modelo", gerada_em: list.defesa.gerada_em ?? null, por: autores.get(list.defesa.por) ?? null }
    : null;
  return {
    list: {
      id: list.id, name: list.name, created_at: list.created_at, campaign_id: list.campaign_id ?? null,
      campaign_name: campaign?.name ?? null, defesa,
    },
    items: enriched,
    projection: squadProjection(enriched),
    notifications: { enabled: isSquadEmailConfigured(), ownerKnown: !!list.user_id },
  };
}

export async function fetchSquads(db) {
  const lists = await fetchPageRows(() => db.from("lists").select("id, name, created_at")
    .order("created_at", { ascending: false }).order("id"));
  const counts = await fetchPageCounts(db, { listIds: lists.map((l) => l.id) });
  const byId = new Map(counts.lists.map((r) => [r.id, r]));
  return lists.map((l) => ({ ...l, total: byId.get(l.id)?.total ?? 0, concluida: byId.get(l.id)?.concluida ?? 0 }));
}
