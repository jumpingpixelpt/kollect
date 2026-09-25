import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreatorInsights, ordenarConteudos } from "../lib/creator-insights.js";

const hoje = new Date("2026-09-17T23:59:59.000Z");
const piece = (id, fields = {}) => ({
  id, creator_id: "conta", platform: "instagram", tipo: "video",
  posted_at: "2026-09-16", url: `https://www.instagram.com/reel/p${id}/`, ...fields,
});

test("insights: 90 dias de calendário UTC incluindo hoje, sem fallback histórico", () => {
  const result = buildCreatorInsights([
    piece("inicio", { posted_at: "2026-06-20" }),
    piece("hoje", { posted_at: "2026-09-17" }),
    piece("antes", { posted_at: "2026-06-19" }),
    piece("futuro", { posted_at: "2026-09-18" }),
    piece("invalida", { posted_at: "2026-06-31" }),
    piece("semdata", { posted_at: null }),
    piece("lixo", { posted_at: "não é uma data" }),
  ], { hoje });
  assert.deepEqual(result.window, { start: "2026-06-20", end: "2026-09-17", days: 90 });
  assert.deepEqual(result.videos.map((video) => video.id), ["hoje", "inicio"]);
  assert.equal(buildCreatorInsights([piece(1, { posted_at: "2026-02-01" })], { hoje }).coverage.total, 0);
});

test("insights: timestamps usam o dia UTC e a duração pode ser um dia", () => {
  const result = buildCreatorInsights([
    piece("utc", { posted_at: "2026-09-18T01:00:00+02:00" }),
    piece("semfuso", { posted_at: "2026-09-17T12:00:00" }),
    piece("amanha", { posted_at: "2026-09-17T23:30:00-02:00" }),
    piece("ontem", { posted_at: "2026-09-16" }),
    piece("timestampInvalido", { posted_at: "2026-09-17T25:00:00Z" }),
  ], { hoje, dias: 1 });
  assert.deepEqual(result.window, { start: "2026-09-17", end: "2026-09-17", days: 1 });
  assert.deepEqual(result.videos.map((video) => video.id), ["semfuso", "utc"]);
  assert.ok(result.videos.every((video) => video.posted_at === "2026-09-17"));
  assert.throws(() => buildCreatorInsights([], { hoje, dias: 0 }), /Janela/);
  assert.throws(() => buildCreatorInsights([], { hoje: "inválida" }), /Janela/);
});

test("insights: cada média usa sua cobertura, preservando zero e ausência", () => {
  const result = buildCreatorInsights([
    piece(1, { comments: 0, saves: null, shares: 0 }),
    piece(2, { comments: 10, saves: 8, shares: null }),
    piece(3, { comments: null, saves: "0", shares: "6" }),
    piece(4, { comments: undefined, saves: -1, shares: Infinity }),
    piece(5, { comments: " ", saves: false, shares: "inválido" }),
  ], { hoje });
  assert.deepEqual(result.metrics.comments, { average: 5, sum: 10, measured: 2, total: 5 });
  assert.deepEqual(result.metrics.saves, { average: 4, sum: 8, measured: 2, total: 5 });
  assert.deepEqual(result.metrics.shares, { average: 3, sum: 6, measured: 2, total: 5 });
  const missing = buildCreatorInsights([piece(1)], { hoje });
  assert.deepEqual(missing.metrics.comments, { average: null, sum: null, measured: 0, total: 1 });
  const empty = buildCreatorInsights([], { hoje });
  assert.deepEqual(empty.metrics.shares, { average: null, sum: null, measured: 0, total: 0 });
});

test("insights: E.R. precisa de views positivas e ao menos uma interação medida", () => {
  const result = buildCreatorInsights([
    piece("parcial", { views: 200, likes: 10, comments: null, saves: 4, shares: null, followers: 100000 }),
    piece("zero", { views: 100, comments: 0 }),
    piece("semInteracoes", { views: 100 }),
    piece("semViews", { views: null, likes: 10 }),
    piece("zeroViews", { views: 0, likes: 10 }),
    piece("imagem", { tipo: "imagem", likes: 10, comments: 2 }),
    piece("fracao", { views: 300, comments: 1 }),
  ], { hoje });
  const byId = Object.fromEntries(result.videos.map((video) => [video.id, video]));
  assert.equal(byId.parcial.engagementRate, 7);
  assert.equal(byId.zero.engagementRate, 0);
  assert.equal(byId.fracao.engagementRate, 0.33);
  for (const id of ["semInteracoes", "semViews", "zeroViews", "imagem"]) assert.equal(byId[id].engagementRate, null);
});

test("insights: deduplica a mesma peça sem unir redes, formatos ou publicações diferentes", () => {
  const result = buildCreatorInsights([
    piece("a", { url: "https://www.instagram.com/reel/mesma/?utm_source=teste", comments: 2 }),
    piece("b", { url: "https://instagram.com/p/mesma/", comments: 2 }),
    piece("c", { platform: "tiktok", url: "https://www.tiktok.com/@um/video/123", comments: 3 }),
    piece("d", { platform: "tiktok", url: "https://www.tiktok.com/@outro/video/123?lang=pt", comments: 3 }),
    piece("e", { platform: "tiktok", url: "https://www.tiktok.com/@um/video/124", comments: 4 }),
    piece("f", { platform: "youtube", url: "https://www.youtube.com/watch?v=abc", comments: 5 }),
    piece("g", { platform: "youtube", url: "https://youtu.be/abc?t=5", comments: 5 }),
    piece("h", { platform: "youtube", url: "https://www.youtube.com/watch?v=def", comments: 6 }),
    piece("i", { url: "https://site.test/watch?id=1", comments: 7 }),
    piece("j", { url: "https://site.test/watch?id=2", comments: 8 }),
    piece("idIg", { url: null, comments: 1 }),
    piece("idIg", { platform: "tiktok", url: null, comments: 2 }),
    piece("imagem", { tipo: "imagem", comments: 3 }),
  ], { hoje });
  assert.equal(result.coverage.total, 10);
  assert.equal(result.metrics.comments.sum, 41);
  assert.equal(result.videos.filter((video) => video.id === "idIg").length, 2);
});

test("insights: palavras contam por peça, preservam acentos e têm evidências do recorte", () => {
  const result = buildCreatorInsights([
    piece("a", { title: "Hidratação hidratação cabelo #publi #cabelocacheado @marca https://marca.test/oferta", transcript: "HIDRATACAO para o cabelo e a saúde. CeraVe." }),
    piece("b", { title: "Hidratação e saúde", transcript: "O cabelo precisa de hidratação. CeraVe." }),
    piece("c", { title: "#maquiagem #fyp #foryoupage #publi #publ1 #viral @nomedesconhecido www.site.test/escondido" }),
    piece("d", { title: " ", transcript: null }),
    piece("antiga", { posted_at: "2026-01-01", title: "Temaantigo" }),
  ], { hoje });
  assert.deepEqual(result.coverage, { total: 4, textMeasured: 3, analisadas: 0 });
  assert.equal(result.topicsFonte, "legendas");
  const terms = Object.fromEntries(result.topics.map((topic) => [topic.term, topic]));
  assert.deepEqual(terms.hidratação, { term: "hidratação", count: 2, videoIds: ["a", "b"] });
  assert.deepEqual(terms.saúde.videoIds, ["a", "b"]);
  assert.equal(terms.cabelo.count, 2);
  assert.equal(terms.cerave.count, 2);
  assert.deepEqual(terms.cabelocacheado, { term: "cabelocacheado", count: 1, videoIds: ["a"] });
  assert.deepEqual(terms.maquiagem, { term: "maquiagem", count: 1, videoIds: ["c"] });
  for (const term of ["publi", "publ", "fyp", "foryoupage", "viral", "marca", "nomedesconhecido", "escondido", "temaantigo", "para", "precisa"]) assert.equal(terms[term], undefined);
  assert.ok(result.topics.every((topic) => topic.count === topic.videoIds.length && topic.videoIds.every((id) => result.videos.some((video) => video.id === id))));
});

test("insights: hashtag temática e texto comum contam uma vez por publicação", () => {
  const result = buildCreatorInsights([
    piece("a", { title: "#Skincare skincare #SKINCARE", transcript: "skincare" }),
    piece("b", { title: "#skincare #Hidratação" }),
    piece("c", { title: "hidratação" }),
  ], { hoje });
  assert.deepEqual(result.topics, [
    { term: "hidratação", count: 2, videoIds: ["b", "c"] },
    { term: "skincare", count: 2, videoIds: ["a", "b"] },
  ]);
  assert.deepEqual(result.coverage, { total: 3, textMeasured: 3, analisadas: 0 });
});

test("insights: limite de 24 termos, ordem por frequência e desempate estável", () => {
  const words = "abacate banana cenoura damasco ervilha feijao goiaba hortela inhame jabuticaba kiwi laranja manga nectarina oregano pera quiabo rucula salsa tomate uva vagem wasabi xuxu yacon zinco aveia brocolis caju";
  const result = buildCreatorInsights([piece("a", { title: words }), piece("b", { title: "zinco zinco zinco" })], { hoje });
  assert.equal(result.topics.length, 24);
  assert.equal(result.topics[0].term, "zinco");
  assert.equal(result.topics[0].count, 2);
  assert.deepEqual(result, buildCreatorInsights([piece("b", { title: "zinco zinco zinco" }), piece("a", { title: words })], { hoje }));
});

test("insights: payload público contém publi da fala, sem notas ou relatórios", () => {
  // os `temas` da análise podem sair (alimentam a nuvem, F3.4); o resto do relatório não
  const source = piece(1, { title: "Tutorial", transcript: "Parceria #publi na fala", content_score: 9, analysis: { veredicto: "relatório privado", temas: [] }, internal: "privado" });
  const result = buildCreatorInsights([source], { hoje });
  assert.equal(result.videos[0].publi, true);
  assert.deepEqual(Object.keys(result.videos[0]).sort(), ["id", "creator_id", "url", "title", "thumb", "posted_at", "platform", "tipo", "views", "likes", "comments", "shares", "saves", "publi", "engagementRate"].sort());
  assert.equal(JSON.stringify(result).includes("relatório privado"), false);
  assert.equal(source.transcript, "Parceria #publi na fala");
  assert.equal(source.content_score, 9);
});

test("ranking: métrica descendente, ausentes excluídos, zeros preservados, data e id estáveis", () => {
  const videos = [
    piece("b", { posted_at: "2026-09-15", views: 100, engagementRate: 5 }),
    piece("a", { posted_at: "2026-09-15", views: 100, engagementRate: 5 }),
    piece("recente", { posted_at: "2026-09-17", views: 100, engagementRate: 0 }),
    piece("visto", { views: 1000, engagementRate: null }),
    piece("zero", { views: 0, engagementRate: null }),
    piece("ausente", { views: null, engagementRate: null }),
    piece("invalido", { views: -1, engagementRate: Infinity }),
  ];
  const before = [...videos];
  assert.deepEqual(ordenarConteudos(videos).map((video) => video.id), ["visto", "recente", "a", "b", "zero"]);
  assert.deepEqual(ordenarConteudos(videos, "engagementRate").map((video) => video.id), ["a", "b", "recente"]);
  assert.deepEqual(ordenarConteudos([...videos].reverse()).map((video) => video.id), ["visto", "recente", "a", "b", "zero"]);
  assert.deepEqual(videos, before);
});

test("insights: nuvem pela análise dos vídeos — temas por peça, plural junto, genéricos fora", () => {
  const result = buildCreatorInsights([
    piece("a", { title: "legenda qualquer", analysis: { temas: ["Cabelo cacheado", "Lifestyle", "Transição capilar"] } }),
    piece("b", { title: "outra legenda", analysis: { temas: ["cabelos cacheados", "Finalização", "finalização"] } }),
    piece("c", { title: "sem análise nenhuma" }),
    piece("velha", { posted_at: "2026-01-01", analysis: { temas: ["Tema antigo"] } }),
  ], { hoje });
  assert.equal(result.topicsFonte, "analise");
  assert.equal(result.coverage.analisadas, 2);
  const terms = Object.fromEntries(result.topics.map((topic) => [topic.term, topic]));
  assert.deepEqual(terms["cabelo cacheado"], { term: "cabelo cacheado", count: 2, videoIds: ["a", "b"] });
  assert.deepEqual(terms["finalização"].videoIds, ["b"]);
  assert.equal(terms.lifestyle, undefined);
  assert.equal(terms["tema antigo"], undefined);
  assert.equal(terms.legenda, undefined);
});

test("insights: sem análise na janela, usa análises antigas; sem nenhuma, legendas", () => {
  const antiga = buildCreatorInsights([
    piece("a", { title: "hidratação" }),
    piece("velha", { posted_at: "2026-01-01", analysis: { temas: ["Skincare"] } }),
  ], { hoje });
  assert.equal(antiga.topicsFonte, "analise_antiga");
  assert.deepEqual(antiga.topics, [{ term: "skincare", count: 1, videoIds: ["velha"] }]);
  const legendas = buildCreatorInsights([piece("a", { title: "hidratação", analysis: { temas: ["Lifestyle"] } })], { hoje });
  assert.equal(legendas.topicsFonte, "legendas");
  assert.deepEqual(legendas.topics.map((t) => t.term), ["hidratação"]);
});
