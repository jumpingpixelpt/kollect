import { fetchPageRows, fetchPageIds } from "./page-data.js";
import { isPubli } from "./publi.js";

const LEITURA = [
  "territorio,conversa,kol_geral:kol_score->geral",
  "niche_bucket:kol_screen->metricas->>niche_bucket",
  "nichos:brand_history->nichos,sub_nichos:brand_history->sub_nichos,formatos:brand_history->formatos",
  "marcas:brand_history->marcas,videos_analisados:brand_history->videos_analisados,escaneado_em:brand_history->escaneado_em",
  "brand_engagement_leitura:brand_history->brand_engagement->>leitura",
].join(",");
const SNAPSHOTS = "captured_at,followers,avg_views,eng_rate,saves_per_1k,shares_per_1k";
const VIDEOS = "id,creator_id,url,title,views,likes,comments,shares,saves,posted_at,transcript,content_score,thumb,tipo";

// Só a conta aberta alimenta o Disaster Check; a análise completa continua no servidor.
// As contas irmãs precisam da transcrição para a mesma régua de publicidade declarada,
// mas não dos relatórios multimodais, que nenhum painel delas usa nesta ficha.
//
// B3.2 (set/2026): da `analysis` (relatório Gemini, ~17 MB na base) a ficha só usa o
// veredicto e os temas (lib/disaster.js) — vêm por JSON path e o objeto é refeito com
// esses dois campos. Todas as análises gravadas têm veredicto, por isso "tem análise"
// (a contagem de peças com fala do Disaster Check) não muda.
const ANALISE = "analise_veredicto:analysis->veredicto,analise_temas:analysis->temas";
const comAnalise = ({ analise_veredicto, analise_temas, ...v }) => ({
  ...v,
  analysis: analise_veredicto != null || analise_temas != null ? { veredicto: analise_veredicto, temas: analise_temas } : null,
});

const TEMAS = "analise_temas:analysis->temas";
const soTemas = ({ analise_temas, ...v }) => ({ ...v, analysis: analise_temas != null ? { temas: analise_temas } : null });

export async function fetchCreatorDetail(db, id) {
  // Perfil + contas irmãs numa ida só (RPC ficha_contas, supabase/migrations/
  // 202609210003_ficha_contas.sql). Antes eram duas leituras da vista `leaderboard` em série.
  // A leaderboard só inclui contas com score; trocar por creators somaria contas ainda não
  // avaliadas que a ficha anterior não apresentava.
  const contasDaPessoa = Promise.resolve(db.rpc("ficha_contas", { p_id: id })).then(({ data, error }) => {
    if (error) throw new Error("Não foi possível carregar o perfil");
    return Array.isArray(data) ? data : [];
  });
  const perfil = contasDaPessoa.then((rows) => rows.find((r) => r.id === id) ?? null);
  const irmas = contasDaPessoa.then(async (rows) => {
    const c = rows.find((r) => r.id === id);
    if (!c) return { contas: [], vidsIrmas: [] };
    const contas = (c.person_key ? rows : [c])
      .map((x) => ({ id: x.id, platform: x.platform, handle: x.handle, followers: x.followers }))
      .sort((a, b) => (b.followers || 0) - (a.followers || 0));
    // Das irmãs vêm só os `temas` da análise (F3.4, rodada 2): a nuvem de palavras da ficha
    // junta todas as contas da pessoa, e é a análise dos vídeos que a alimenta quando existe.
    const vidsIrmas = await fetchPageIds((ids) => db.from("videos").select(`${VIDEOS},${TEMAS}`).in("creator_id", ids)
      .order("posted_at", { ascending: false }).order("id"), contas.filter((x) => x.id !== c.id).map((x) => x.id))
      .then((rows) => rows.map(soTemas));
    return { contas, vidsIrmas };
  });
  const [c, { data: leitura }, snaps, videos, cc, outras] = await Promise.all([
    perfil,
    db.from("creators").select(LEITURA).eq("id", id).maybeSingle().throwOnError(),
    fetchPageRows(() => db.from("snapshots").select(SNAPSHOTS).eq("creator_id", id).order("captured_at").order("id")),
    fetchPageRows(() => db.from("videos").select(`${VIDEOS},${ANALISE}`).eq("creator_id", id)
      .order("posted_at", { ascending: false }).order("id")).then((rows) => rows.map(comAnalise)),
    fetchPageRows(() => db.from("campaign_creators")
      .select("id,campaign_id,rationale,status,campaigns(id,name,user_id,shared_with)")
      .eq("creator_id", id).order("created_at", { ascending: false }).order("id")),
    irmas,
  ]);
  return { c, bh: profileReading(leitura), snaps, videos, cc, ...outras };
}

export function profileReading(r) {
  if (!r) return null;
  return {
    territorio: r.territorio, conversa: r.conversa,
    kol_score: { geral: r.kol_geral },
    kol_screen: { metricas: { niche_bucket: r.niche_bucket } },
    brand_history: {
      nichos: r.nichos, sub_nichos: r.sub_nichos, formatos: r.formatos, marcas: r.marcas,
      videos_analisados: r.videos_analisados, escaneado_em: r.escaneado_em,
      brand_engagement: { leitura: r.brand_engagement_leitura },
    },
  };
}

// ConteudosGrid é client: a legenda é visível, a transcrição e o relatório completo não.
// O booleano sai da mesma função usada pela saturação/scorecard, inclusive publi só na fala.
export function contentVideosForClient(videos) {
  return (videos || []).map((v) => ({
    id: v.id, url: v.url, title: v.title, thumb: v.thumb, posted_at: v.posted_at,
    platform: v.platform, tipo: v.tipo, content_score: v.content_score,
    views: v.views, likes: v.likes, comments: v.comments, shares: v.shares, saves: v.saves,
    publi: isPubli(v),
  }));
}
