import { test } from "node:test";
import assert from "node:assert/strict";
import { tagDe, tagDaFicha, classeDe, TAG_LABEL, TAG_ORDER } from "../lib/casting.js";
import { CAMPOS, TERRITORIO_KEYWORDS, rotulo, termos, porPreencher, camposCompat, LIMITE_BRIEFING } from "../lib/briefing-campos.js";
import { normalizarTemas, keywordsComTemas, termosDosTemas } from "../lib/temas.js";
import { alargarFaixa } from "../lib/casting-prefiltro.js";
import { ligarPecas, norm } from "../lib/marcas-pecas.js";
import { scorecardRede } from "../lib/scorecard.js";

const cr = (classe, elegivel = true) => ({ kol_score: { geral: { classe, elegivel, score: 70 } } });

test("tagDe: só três tags — Pool absorve Hidden Gem, Brand Safe, Watchlist e elegível", () => {
  const row = { kind: "rising" };
  assert.equal(tagDe(row, cr("kol")), "kol");
  assert.equal(tagDe(row, cr("rising_star")), "rising_star");
  assert.equal(tagDe(row, cr("hidden_gem")), "pool");
  assert.equal(tagDe(row, cr("brand_safe_performer")), "pool");
  assert.equal(tagDe(row, cr("elegivel")), "pool");
  assert.equal(tagDe(row, cr(null)), "pool");
  // sem kol_score cai no kol_screen; sem nada, no kind da linha
  assert.equal(tagDe({ kind: "kol" }, {}), "kol");
  assert.equal(tagDe({ kind: "rising" }, { kol_screen: { classe: "hidden_gem" } }), "pool");
  assert.deepEqual(TAG_ORDER, ["kol", "rising_star", "pool"]);
  assert.deepEqual(Object.keys(TAG_LABEL), TAG_ORDER);
});

test("tagDaFicha: inelegível é Pool, sem score é sem tag", () => {
  assert.equal(tagDaFicha(cr("kol")), "kol");
  assert.equal(tagDaFicha(cr("brand_safe_performer")), "pool");
  assert.equal(tagDaFicha(cr("kol", false)), "pool");
  assert.equal(tagDaFicha({}), null);
  assert.equal(tagDaFicha(null), null);
});

test("classeDe: ramo masculino do Score KOL", () => {
  const c = { kol_score: { geral: { classe: "kol" }, masculino: { classe: "elegivel" } } };
  assert.equal(classeDe({}, c, "geral"), "kol");
  assert.equal(classeDe({}, c, "masculino"), "promissora");
});

test("briefing-campos: marca e produto separados, três fechados, opcionais marcados", () => {
  assert.deepEqual(CAMPOS.map((c) => c.k), ["marca", "produto", "objetivo", "tema_territorio", "plataforma", "referencia"]);
  assert.deepEqual(CAMPOS.filter((c) => c.opcional).map((c) => c.k), ["marca", "produto", "referencia"]);
  const fechados = CAMPOS.filter((c) => c.opcoes).map((c) => c.k);
  assert.deepEqual(fechados, ["objetivo", "tema_territorio", "plataforma"]);
  assert.deepEqual(CAMPOS.find((c) => c.k === "objetivo").opcoes.map(([k]) => k), ["Awareness", "Engajamento", "Venda"]);
  assert.deepEqual(CAMPOS.find((c) => c.k === "tema_territorio").opcoes.map(([k]) => k), ["Cabelo", "Unha", "Maquiagem", "Pele", "Perfume"]);
  assert.deepEqual(CAMPOS.find((c) => c.k === "plataforma").opcoes.map(([k]) => k), ["tiktok", "instagram", "ambas"]);
  assert.equal(CAMPOS.find((c) => c.k === "referencia").tipo, "url");
  assert.equal(LIMITE_BRIEFING, 3000);
  const terr = CAMPOS.find((c) => c.k === "tema_territorio");
  for (const k of Object.keys(TERRITORIO_KEYWORDS)) assert.ok(terr.opcoes.some(([o]) => o === k), `território ${k} sem opção`);
});

test("rotulo e termos", () => {
  const plat = CAMPOS.find((c) => c.k === "plataforma");
  assert.equal(rotulo(plat, "tiktok"), "TikTok");
  assert.equal(rotulo(plat, "desconhecido"), "desconhecido");
  assert.equal(rotulo(CAMPOS[0], " Elsève "), "Elsève");
  assert.deepEqual(termos("contas de salão, concorrente X; termo Y\nab"), ["contas de salão", "concorrente x", "termo y"]);
  const faltam = porPreencher({ objetivo: { valor: "Venda", claro: true }, plataforma: { valor: "", claro: true } });
  assert.ok(faltam.some((c) => c.k === "plataforma") && !faltam.some((c) => c.k === "objetivo"));
  assert.ok(!faltam.some((c) => c.opcional), "marca/produto/referência não ficam por completar");
  // leitura antiga: produto_marca → marca
  assert.deepEqual(camposCompat({ produto_marca: { valor: "Elsève", claro: true } }), { marca: { valor: "Elsève", claro: true } });
});

test("temas: normaliza, junta termos às keywords sem repetir", () => {
  const temas = normalizarTemas([
    { rotulo: " GLP-1 ", termos_pt: ["Ozempic", "ozempic", ""], termos_en: "semaglutide, glp-1", situacoes: ["x"] },
    { rotulo: "glp-1", termos_pt: ["duplicado"] },
    { rotulo: "" },
    "Baby hair",
  ]);
  assert.deepEqual(temas.map((t) => t.rotulo), ["GLP-1", "Baby hair"]);
  assert.deepEqual(temas[0].termos_pt, ["ozempic"]);
  assert.deepEqual(temas[0].termos_en, ["semaglutide", "glp-1"]);
  assert.deepEqual(termosDosTemas(temas), ["ozempic", "semaglutide", "glp-1"]);
  assert.deepEqual(keywordsComTemas(["Queda", "ozempic"], temas), ["queda", "ozempic", "semaglutide", "glp-1"]);
});

test("alargarFaixa: uma faixa para cada lado", () => {
  assert.deepEqual(alargarFaixa(10_000, 50_000), { min: 0, max: 200_000 });
  assert.deepEqual(alargarFaixa(30_000, 80_000), { min: 10_000, max: 200_000 });
  assert.deepEqual(alargarFaixa(200_000, 0), { min: 50_000, max: 0 });
  assert.deepEqual(alargarFaixa(0, 1_000_000), { min: 0, max: 0 });
  assert.deepEqual(alargarFaixa(0, 0), { min: 0, max: 0 });
});

test("ligarPecas: nome, evidência e marca composta; ordena por data", () => {
  const vids = [
    { url: "u1", posted_at: "2026-05-01", views: 10, txt: norm("Hoje testei o Elseve Glycolic Gloss #publi") },
    { url: "u2", posted_at: "2026-07-01", views: 20, txt: norm("rotina com l'oréal paris elseve, amei") },
    { url: "u3", posted_at: "2026-06-01", views: 30, txt: norm("dia de salão sem marca nenhuma") },
    { url: null, posted_at: "2026-08-01", views: 40, txt: norm("elseve sem url não conta") },
  ];
  const pecas = ligarPecas({ marca: "L'Oréal Elseve", evidencia: "Glycolic Gloss #publi" }, vids);
  assert.deepEqual(pecas.map((p) => p.url), ["u2", "u1"]);
  assert.equal(pecas[0].data, "2026-07-01");
  assert.deepEqual(ligarPecas({ marca: "Ok" }, vids), []);            // nome curto de mais
  assert.deepEqual(ligarPecas({ marca: "Vichy" }, vids), []);         // não aparece
});

test("scorecardRede: janela de 90 dias e fallback declarado", () => {
  const hoje = new Date("2026-09-11");
  const d = (dias) => new Date(hoje.getTime() - dias * 864e5).toISOString().slice(0, 10);
  const v = (dias, views, likes, comments) => ({ posted_at: d(dias), views, likes, comments });
  const dentro = [v(5, 1000, 100, 10), v(40, 2000, 100, 20), v(80, 3000, 100, 30)];
  const fora = [v(120, 9000, 900, 90)];
  const c = scorecardRede([...dentro, ...fora], { hoje });
  assert.equal(c.dias, 90);
  assert.equal(c.fallback, false);
  assert.equal(c.posts, 3);
  assert.equal(c.views, 6000);
  assert.equal(c.comentariosMedia, 20);
  // taxa = engajamentos ÷ views, nunca sobre seguidores
  assert.equal(c.taxaEng, Math.round((360 / 6000) * 10000) / 100);
  // com só 2 peças na janela cai nas últimas `minimo` e diz que caiu
  const f = scorecardRede([v(5, 1, 1, 1), v(10, 1, 1, 1), ...fora], { hoje, minimo: 12 });
  assert.equal(f.fallback, true);
  assert.equal(f.posts, 3);
  assert.equal(scorecardRede([], { hoje }), null);
});

test("contaNoCasting: risco alto no disaster check não entra; manual entra sempre", async () => {
  const { contaNoCasting } = await import("../lib/casting.js");
  const alto = { kol_score: { geral: { classe: "kol", elegivel: true } }, kol_screen: { disaster: { nivel: "alto" } } };
  const medio = { kol_score: { geral: { classe: "kol", elegivel: true } }, kol_screen: { disaster: { nivel: "medio" } } };
  assert.equal(contaNoCasting({ kind: "kol" }, alto), false);
  assert.equal(contaNoCasting({ kind: "kol" }, medio), true);
  assert.equal(contaNoCasting({ kind: "manual" }, alto), true);
});

test("resumoDisaster: nível a partir das legendas e falas", async () => {
  const { resumoDisaster, chumbaDisaster } = await import("../lib/disaster.js");
  const limpo = resumoDisaster({ bio: "hair expert", videos: [{ title: "cronograma capilar", transcript: "hidratação e nutrição" }] });
  assert.equal(limpo.nivel, "limpo");
  assert.deepEqual(limpo.sinais, []);
  const vazio = resumoDisaster({ bio: "", videos: [] });
  assert.equal(vazio.nivel, "sem_base");
  const bets = resumoDisaster({ videos: [{ title: "cupom na blaze e no tigrinho hoje", transcript: "" }] });
  assert.ok(bets.sinais.length >= 1);
  // "bet" só como palavra inteira: "bettdow" é um fone, não uma casa de apostas
  const fone = resumoDisaster({ videos: [{ title: "chegou meu fone novo da bettdow", transcript: "a beta do app" }] });
  assert.deepEqual(fone.sinais, []);
  assert.ok(resumoDisaster({ videos: [{ title: "entra na bet e aposta", transcript: "" }] }).sinais.length >= 1);
  // verbo apostar e "blaze" sem contexto de jogo não marcam; casa de apostas marca
  assert.deepEqual(resumoDisaster({ videos: [{ title: "Beterraba… Ervilha… enfim, apostaria nessas fragrâncias?", transcript: "eu aposto que você vai amar" }] }).sinais, []);
  assert.deepEqual(resumoDisaster({ videos: [{ title: "", transcript: "usei a blaze no cabelo e a roleta de sabores" }] }).sinais, []);
  assert.deepEqual(resumoDisaster({ videos: [{ title: "cupom na casa de apostas", transcript: "" }] }).sinais, ["Bets e jogos de azar"]);
  assert.deepEqual(resumoDisaster({ videos: [{ title: "", transcript: "vem jogar na blaze com meu código" }] }).sinais, ["Bets e jogos de azar"]);
  assert.equal(chumbaDisaster({ disaster: { nivel: "alto" } }), true);
  assert.equal(chumbaDisaster({ disaster: { nivel: "medio" } }), false);
});
