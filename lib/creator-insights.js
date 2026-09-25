import { engRateViews } from "./engagement.js";
import { isPubli } from "./publi.js";

const DAY = 864e5;
const INTERACTIONS = ["likes", "comments", "shares", "saves"];
const COUNTS = ["views", ...INTERACTIONS];
const normalizar = (text) => text.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
// Palavras funcionais e chamadas comuns de rede social não descrevem o tema da peça.
// Marcas e termos de conteúdo permanecem; não há classificação nem peso de IA.
const STOPWORDS = new Set(normalizar(`
a ao aos aquela aquelas aquele aqueles aquilo as até com como da das de dela delas dele deles
depois dessa dessas desse desses desta destas deste destes do dos e ela elas ele eles em entre
era eram essa essas esse esses esta estamos estar estas estava estavam este estes estou eu foi
fomos foram fosse fossem há isso isto já lá lhe lhes mais mas me mesmo mesma mesmos mesmas minha
minhas meu meus muito muita muitas muitos na nas não nem no nos nós nossa nossas nosso nossos
num numa o os ou para pela pelas pelo pelos por porque porquê pra pro quando que quem qual quais
se sem ser será serão seja sejam seu seus sua suas só sob sobre sou também te tem temos tendo tenho
ter teu teus toda todas todo todos tu um uma umas uns você vocês vos vcs vc q pq mim comigo contigo
aí aqui ali assim ainda agora antes bem cada coisa coisas então fazer faz fazem feito feita feitos
feitas fica ficar ficou gente hoje onde olha olhem pode podem poderia pois pouco precisa precisam
precisava preciso quero queremos querem quer sim sempre sendo tá to tava tanto tudo usa usar
uso vai vamos vou ver vez vezes fui irei irá vão tinha tinham teria teriam tive teve têm porém portanto
contudo durante através após desde perto longe apenas quanto nunca nada algo alguma algumas algum
alguns outro outra outros outras nenhum nenhuma dentre enquanto dali daqui nesse nessa nesses nessas
nisso nisto disso disto saber dizer disse deu dar deixa deixe duas dois três realmente super vários
várias vem bora conseguir consegue conseguimos vendo veja vejam fazendo gostei gostar gosta usando
usado usada usados usadas use usem traz trazer trouxe chegou chegar chega vindo voltar volta voltando
sair saiu sai bom boa boas bons somente bastante quase talvez certeza além obrigada obrigado beijão
beijo beijos galera pessoal oi olá tchau haha hahaha rs kkk kkkk
publi publis publ publ1 publicidade parceriapaga ad parceria instagram tiktok youtube facebook reels reel shorts post
posts postar postagem publicação publicações conteúdo conteúdos vídeo vídeos compartilhe compartilhar
curtir curta curtam curtidas salve salvar siga seguir inscreva inscrito inscritos link bio fyp foryou foryoupage
viral trend trends trending hashtag hashtags
`).split(/\s+/));

function measuredNumber(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function calendarDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const day = value.slice(0, 10);
  const midnight = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== day) return null;
  if (value.length === 10) return day;
  // Sem fuso explícito, a fonte é interpretada em UTC, não no fuso do servidor.
  const timestamp = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString().slice(0, 10) : null;
}

function publicationKey(video) {
  const platform = String(video.platform || "").toLowerCase();
  try {
    const url = new URL(video.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    const ig = /^(?:www\.)?instagram\.com$/.test(host) && path.match(/^\/(?:p|reel|reels|tv)\/([\w-]+)$/);
    const tk = /(^|\.)tiktok\.com$/.test(host) && path.match(/\/video\/(\d+)$/);
    const yt = /(^|\.)(?:youtube\.com|youtu\.be)$/.test(host)
      && (host === "youtu.be" ? path.slice(1) : url.searchParams.get("v") || path.match(/^\/(?:shorts|embed)\/([\w-]+)$/)?.[1]);
    if (ig) return `${platform || "instagram"}:ig:${ig[1]}`;
    if (tk) return `${platform || "tiktok"}:tk:${tk[1]}`;
    if (yt) return `${platform || "youtube"}:yt:${yt}`;
    // Fora das redes conhecidas, parâmetros podem identificar publicações diferentes.
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:fbclid|igshid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${platform}:url:${host}${path}${url.search}`;
  } catch {
    return video.id == null ? null : `${platform}:id:${video.creator_id ?? ""}:${video.id}`;
  }
}

const recentFirst = (a, b) => String(b.posted_at || "").localeCompare(String(a.posted_at || ""))
  || String(a.id ?? "").localeCompare(String(b.id ?? ""))
  || String(a.creator_id ?? "").localeCompare(String(b.creator_id ?? ""))
  || String(a.platform ?? "").localeCompare(String(b.platform ?? ""));

function metric(videos, field) {
  const values = videos.map((video) => video[field]).filter((value) => value != null);
  const sum = values.length ? values.reduce((total, value) => total + value, 0) : null;
  return { average: values.length ? sum / values.length : null, sum, measured: values.length, total: videos.length };
}

function extractTopics(videos) {
  const topics = new Map();
  let textMeasured = 0;
  for (const video of videos) {
    const original = [video.title, video.transcript].filter((value) => typeof value === "string").join(" ");
    if (!original.trim()) continue;
    textMeasured++;
    // Hashtags temáticas são evidência textual: #skincare e skincare contam juntas,
    // uma vez por peça. O tokenizador retira o #; stopwords retiram publi/fyp/spam.
    const text = original.replace(/(?:https?:\/\/|www\.)\S+/giu, " ")
      .replace(/@[\p{L}\p{N}_.]+/gu, " ");
    const inVideo = new Map();
    for (const [word] of text.matchAll(/[\p{L}\p{M}]+/gu)) {
      const key = normalizar(word);
      if (key.length < 3 || STOPWORDS.has(key) || /^(.)\1+$/.test(key)) continue;
      const label = word.toLocaleLowerCase("pt-BR").normalize("NFC");
      // Uma legenda/fala repetida nunca dá mais peso à publicação.
      if (!inVideo.has(key) || (label !== key && inVideo.get(key) === key)) inVideo.set(key, label);
    }
    if (video.id == null) continue;
    for (const [key, label] of inVideo) {
      const topic = topics.get(key) || { forms: new Map(), videoIds: [] };
      topic.forms.set(label, (topic.forms.get(label) || 0) + 1);
      topic.videoIds.push(video.id);
      topics.set(key, topic);
    }
  }
  const entries = [...topics.entries()].map(([key, topic]) => {
    const term = [...topic.forms].sort((a, b) => b[1] - a[1]
      || Number(b[0] !== key) - Number(a[0] !== key) || a[0].localeCompare(b[0], "pt-BR"))[0][0];
    return { term, count: topic.videoIds.length, videoIds: topic.videoIds };
  }).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "pt-BR")).slice(0, 24);
  return { topics: entries, textMeasured };
}

/**
 * Nuvem a partir da ANÁLISE dos vídeos (feedback rodada 2, F3.4 — set/2026): o cliente pediu
 * «palavras do nicho, de acordo com a análise do que está sendo analisado nos vídeos». A
 * análise Gemini do deep-scan (`videos.analysis`) traz `temas` — 2 a 4 expressões curtas
 * por peça, já no vocabulário do nicho («cabelo cacheado», «transição capilar», «skincare»).
 * Cada tema conta UMA vez por peça; o peso é o número de peças que o trazem.
 *
 * Singular e plural juntam-se na chave («cabelos cacheados» = «cabelo cacheado»); fica a
 * forma mais frequente. Temas de rótulo genérico (lifestyle, entretenimento, vlog…) saem:
 * descrevem o formato, não o assunto. Só `temas` entra — marcas têm painel próprio na ficha.
 */
const TEMAS_GENERICOS = new Set(["lifestyle", "estilo de vida", "entretenimento", "vlog", "vlogs",
  "conteudo", "video", "videos", "publicidade", "publi", "parceria", "parceria paga", "dia a dia",
  "cotidiano", "rotina", "geral", "outros", "diversos", "variedades", "trend", "trends", "viral"]);
const chaveTema = (t) => normalizar(t).replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim()
  .split(" ").map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join(" ");

export function temasDaAnalise(video) {
  const temas = video?.analysis?.temas;
  return Array.isArray(temas) ? temas.filter((t) => typeof t === "string" && t.trim()) : [];
}

function extractTopicsAnalise(videos) {
  const topics = new Map();
  let analisadas = 0;
  for (const video of videos) {
    const temas = temasDaAnalise(video);
    if (!temas.length) continue;
    analisadas++;
    if (video.id == null) continue;
    const naPeca = new Map();
    for (const bruto of temas) {
      const label = bruto.trim().replace(/\s+/g, " ").slice(0, 40).toLocaleLowerCase("pt-BR").normalize("NFC");
      const key = chaveTema(label);
      if (key.length < 3 || TEMAS_GENERICOS.has(normalizar(label)) || TEMAS_GENERICOS.has(key) || STOPWORDS.has(key)) continue;
      if (!naPeca.has(key)) naPeca.set(key, label);
    }
    for (const [key, label] of naPeca) {
      const topic = topics.get(key) || { forms: new Map(), videoIds: [] };
      topic.forms.set(label, (topic.forms.get(label) || 0) + 1);
      topic.videoIds.push(video.id);
      topics.set(key, topic);
    }
  }
  const entries = [...topics.values()].map((topic) => {
    const term = [...topic.forms].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], "pt-BR"))[0][0];
    return { term, count: topic.videoIds.length, videoIds: topic.videoIds };
  }).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, "pt-BR")).slice(0, 24);
  return { topics: entries, analisadas };
}

/**
 * Leitura gratuita das peças já persistidas. A janela é estrita: 90 dias de calendário
 * UTC incluindo hoje, sem recorrer a peças antigas para preencher uma base pequena.
 * Valores desconhecidos não viram zero nem entram no denominador das médias.
 */
export function buildCreatorInsights(videos, { hoje = new Date(), dias = 90 } = {}) {
  const now = new Date(hoje);
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(dias) || dias < 1) throw new RangeError("Janela de conteúdo inválida");
  const end = now.toISOString().slice(0, 10);
  const start = new Date(new Date(`${end}T00:00:00.000Z`).getTime() - (dias - 1) * DAY).toISOString().slice(0, 10);
  const seen = new Set();
  const selected = (videos || []).filter(Boolean).map((video) => ({ ...video, posted_at: calendarDay(video.posted_at) }))
    .filter((video) => video.posted_at && video.posted_at >= start && video.posted_at <= end)
    .sort(recentFirst).filter((video) => {
      const key = publicationKey(video);
      if (key == null) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const clean = selected.map((video) => {
    const counts = Object.fromEntries(COUNTS.map((field) => [field, measuredNumber(video[field])]));
    const interactions = INTERACTIONS.map((field) => counts[field]).filter((value) => value != null);
    return {
      id: video.id, creator_id: video.creator_id, url: video.url ?? null,
      title: video.title ?? null, thumb: video.thumb ?? null, posted_at: video.posted_at,
      platform: video.platform ?? null, tipo: video.tipo ?? null, ...counts,
      publi: isPubli(video),
      // A taxa usa somente interações observadas; não pressupõe shares/saves completos.
      engagementRate: interactions.length ? engRateViews(interactions.reduce((sum, value) => sum + value, 0), counts.views) : null,
    };
  });
  // Nuvem: a análise dos vídeos manda quando existe (F3.4, rodada 2). Primeiro as peças
  // analisadas DENTRO da janela — clicar num tema filtra o Top, que é da janela. Sem nenhuma,
  // as análises de qualquer data (o deep-scan corre a 3 peças por creator e podem ser mais
  // antigas que 90 dias): a nuvem descreve o nicho, mas os temas deixam de filtrar o Top.
  // Sem análise nenhuma, a nuvem de sempre — legenda + transcrição —, dita como tal.
  const { textMeasured, topics: topicsLegendas } = extractTopics(selected);
  let topics = topicsLegendas, fonte = "legendas", analisadas = 0;
  const naJanela = extractTopicsAnalise(selected);
  if (naJanela.topics.length) {
    ({ topics, analisadas } = naJanela);
    fonte = "analise";
  } else {
    const vistas = new Set();
    const todas = (videos || []).filter(Boolean).filter((video) => temasDaAnalise(video).length).filter((video) => {
      const key = publicationKey(video);
      if (key == null) return true;
      if (vistas.has(key)) return false;
      vistas.add(key);
      return true;
    });
    const historico = extractTopicsAnalise(todas);
    if (historico.topics.length) {
      ({ topics, analisadas } = historico);
      fonte = "analise_antiga";
    }
  }
  return {
    window: { start, end, days: dias },
    metrics: Object.fromEntries(["comments", "saves", "shares"].map((field) => [field, metric(clean, field)])),
    videos: clean, topics, topicsFonte: fonte, coverage: { total: clean.length, textMeasured, analisadas },
  };
}

/** Ordenação reproduzível: valores ausentes ficam fora do ranking, zero medido entra. */
export function ordenarConteudos(videos, criterio = "views") {
  const field = criterio === "engagementRate" ? "engagementRate" : "views";
  return (videos || []).filter((video) => measuredNumber(video?.[field]) != null)
    .slice().sort((a, b) => measuredNumber(b[field]) - measuredNumber(a[field]) || recentFirst(a, b));
}
