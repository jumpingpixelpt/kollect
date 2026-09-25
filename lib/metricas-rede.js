/**
 * MÉTRICAS POR REDE — o retrato de 90 dias de uma PESSOA, pré-calculado para o card do
 * briefing (feedback rodada 2, F1.7 — set/2026; coluna creators.metricas_rede).
 *
 * O card expandido de /campanha/[id] mostra uma linha por rede (Instagram, TikTok), «Só
 * publis» e «Todas as redes», como os Resultados da ficha (components/ScorecardRedes.js). A
 * página do briefing não pode carregar as peças de 150 creators por pedido, por isso o
 * resultado fica gravado em JSON e a página só lê esse campo.
 *
 * Mesmas réguas da ficha, sem cópias:
 *  - a janela de cada conta é a do lib/scorecard.js (90 dias; sem 3 peças na janela, cai
 *    nas últimas 12 e diz que caiu — `fallback` + datas reais viajam no JSON);
 *  - publi é o lib/publi.js (legenda + transcrição), sobre as peças do recorte de todas
 *    as contas da pessoa — a mesma base da linha «Só publis» da ficha.
 *
 * Uma diferença deliberada face à ficha: views médias e taxa de engajamento contam só as
 * peças com views medidas. As fotos do Instagram não têm views; somá-las como 0 baixava as
 * views médias e punha os likes delas no numerador de uma taxa cujo denominador não as
 * inclui. A taxa é SEMPRE engajamentos ÷ views (lib/engagement.js) e fica null sem views.
 * Os comentários por peça contam todas as peças do recorte.
 *
 * `seguidores` de cada rede é o da conta (creators.followers); no total é a soma das contas.
 */
import { scorecardRede, engDaPeca } from "./scorecard.js";
import { isPubli } from "./publi.js";
import { engRateViews } from "./engagement.js";

export const METRICAS_REDE_VERSAO = 1;
const DIAS = 90;

const soma = (arr, f) => arr.reduce((s, v) => s + (Number(f(v)) || 0), 0);

/** Números de um conjunto de peças; null sem peças. */
export function numerosDe(pecas) {
  const n = (pecas || []).length;
  if (!n) return null;
  const medidas = pecas.filter((v) => Number(v.views) > 0);
  const views = soma(medidas, (v) => v.views);
  return {
    n_pecas: n,
    n_com_views: medidas.length,
    views_media: medidas.length ? Math.round(views / medidas.length) : null,
    eng_rate: engRateViews(soma(medidas, engDaPeca), views),
    comentarios_media: Math.round(soma(pecas, (v) => v.comments) / n),
  };
}

/**
 * @param {Array} contas  [{ id, handle, platform, followers }] — as contas da pessoa
 * @param {Array} videos  peças de todas essas contas: { creator_id, title, transcript,
 *                        views, likes, comments, shares, saves, posted_at }
 * @returns {object|null} o JSON de creators.metricas_rede, ou null sem peças com data
 */
export function calcularMetricasRede(contas, videos, { hoje = new Date() } = {}) {
  const porConta = {};
  for (const v of videos || []) (porConta[v.creator_id] ||= []).push(v);

  // a mesma pessoa pode ter duas contas na mesma rede: juntam-se as peças do recorte de
  // cada uma e somam-se os seguidores (a linha é por rede, não por conta)
  const porRede = {};
  for (const c of contas || []) {
    const card = scorecardRede(porConta[c.id] || [], { dias: DIAS, hoje });
    if (!card) continue;
    const r = (porRede[c.platform || "outra"] ||= { contas: [], pecas: [], seguidores: 0, fallback: false, de: null, ate: null });
    r.contas.push({ id: c.id, handle: c.handle });
    r.pecas.push(...card.pecas);
    r.seguidores += Number(c.followers) || 0;
    r.fallback ||= card.fallback;
    if (!r.de || card.de < r.de) r.de = card.de;
    if (!r.ate || card.ate > r.ate) r.ate = card.ate;
  }
  const nomes = Object.keys(porRede);
  if (!nomes.length) return null;

  const redes = {};
  for (const nome of nomes) {
    const r = porRede[nome];
    redes[nome] = {
      ...numerosDe(r.pecas),
      seguidores: r.seguidores || null,
      handles: r.contas.map((x) => x.handle).filter(Boolean),
      fallback: r.fallback, de: r.de, ate: r.ate,
    };
  }

  const todas = nomes.flatMap((n) => porRede[n].pecas);
  const publis = todas.filter(isPubli);
  const organicas = todas.filter((v) => !isPubli(v));
  const segTotal = nomes.reduce((s, n) => s + porRede[n].seguidores, 0);

  return {
    v: METRICAS_REDE_VERSAO,
    dias: DIAS,
    redes,
    total: { ...numerosDe(todas), seguidores: segTotal || null },
    publi: numerosDe(publis),
    organico: numerosDe(organicas),
    computed_at: new Date().toISOString(),
  };
}

// Colunas mínimas de `videos` para o cálculo. A transcrição entra porque o lib/publi.js
// também procura a declaração de publi na fala (é pequena: ~4 MB na base toda, set/2026).
export const VIDEOS_METRICAS = "creator_id,title,transcript,views,likes,comments,shares,saves,posted_at";

/**
 * Recalcula e grava o metricas_rede de todas as contas da pessoa de `creatorId` (cada conta
 * guarda o retrato da pessoa inteira, como a ficha mostra). Best-effort do lado de quem
 * chama: devolve { ok, contas } ou lança.
 */
export async function atualizarMetricasRede(db, creatorId) {
  const { data: c, error } = await db.from("creators").select("id,handle,platform,followers,person_key").eq("id", creatorId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) return { ok: false, contas: 0 };
  let contas = [c];
  if (c.person_key) {
    const { data: irmas, error: e2 } = await db.from("creators").select("id,handle,platform,followers,person_key").eq("person_key", c.person_key);
    if (e2) throw new Error(e2.message);
    if (irmas?.length) contas = irmas;
  }
  const ids = contas.map((x) => x.id);
  const videos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error: e3 } = await db.from("videos").select(VIDEOS_METRICAS).in("creator_id", ids).order("id").range(de, de + 999);
    if (e3) throw new Error(e3.message);
    videos.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const json = calcularMetricasRede(contas, videos);
  const { error: e4 } = await db.from("creators").update({ metricas_rede: json }).in("id", ids);
  if (e4) throw new Error(e4.message);
  return { ok: true, contas: ids.length };
}
