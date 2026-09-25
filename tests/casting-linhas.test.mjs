import { test } from "node:test";
import assert from "node:assert/strict";
import { prepararCasting, filtrarVista, paginar, linhasIniciais, resumoLinha, cardLinha, exportCasting, POR_PAGINA } from "../lib/casting-linhas.js";

// Casting sintético (sem banco): 45 creators, uma pessoa com duas contas, um lote de
// «Mais nomes», uma com disaster check alto e um prospect do funil.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function criarCreator(n, extra = {}) {
  return {
    id: uuid(n), name: `Creator ${n}`, handle: `creator${n}`, platform: n % 2 ? "instagram" : "tiktok",
    followers: 1000 * n, avatar_url: null, person_key: null, kol_score: null,
    kol_screen: { classe: n % 3 === 0 ? "kol" : n % 3 === 1 ? "rising_star" : "hidden_gem", disaster: null, metricas: { niche_bucket: n % 4 ? "cabelo" : "maquiagem", niche_density: 50, eng_index: 1.2, consistency_pct: 70 } },
    brand_history: { nichos: [{ nicho: "cabelo", pct: 60 }], sub_nichos: [] },
    audience: { mulheres_pct: 80 }, conversa: { volume: null, conteudo: { pct_duvidas: null } },
    metricas_rede: { total: { eng_rate: 3.5, comentarios_media: 12 } },
    ...extra,
  };
}
function cenario({ camp: campExtra = {} } = {}) {
  const creators = Array.from({ length: 45 }, (_, i) => criarCreator(i + 1));
  creators[4].name = "Ana Júlia"; // busca sem acentos
  creators[9].person_key = "pessoa-x"; creators[10].person_key = "pessoa-x"; // mesma pessoa
  creators[11].kol_screen.disaster = { nivel: "alto", sinais: ["x"] }; // fora do casting
  const rows = creators.map((c, i) => ({
    id: uuid(1000 + i), creator_id: c.id, prospect_id: null, kind: "auto",
    match_score: 100 - i, rationale: "", status: "sugerida", campaign_role: null, lote: i >= 40 ? 1 : 0,
  }));
  rows[42].match_score = 200; // lote 1 fica no fim mesmo com match maior
  rows.push({ id: uuid(2000), creator_id: null, prospect_id: "tb-1", kind: "funil", match_score: 1, rationale: "x", status: "sugerida", campaign_role: null, lote: 0 });
  const detalhe = {
    creators, prospects: [{ tubular_id: "tb-1", name: "Prospect Um", thumbnail: null, followers: 10, status: "novo" }],
    promotedLink: [], snapBy: {},
    irmasAll: [creators[9], creators[10]].map((c) => ({ id: c.id, handle: c.handle, platform: c.platform, followers: c.followers, person_key: c.person_key })),
  };
  const camp = { id: uuid(9), name: "Briefing cabelo", briefing: "cachos", parsed: { keywords: ["cabelo"] }, ...campExtra };
  return { camp, rows, detalhe };
}

test("ordem: lote primeiro, depois aderência; uma linha por pessoa; disaster alto fora", () => {
  const { camp, rows, detalhe } = cenario();
  const ctx = prepararCasting(camp, rows, detalhe);
  const ids = ctx.lista.map((r) => r.creator_id);
  assert.equal(ctx.lista.length, 43); // 45 − irmã − disaster alto
  assert.ok(!ids.includes(uuid(12)));
  assert.ok(ids.includes(uuid(10)) && !ids.includes(uuid(11))); // fica a conta com melhor match
  assert.deepEqual(ids.slice(-5), [uuid(43), uuid(41), uuid(42), uuid(44), uuid(45)]); // lote 1 no fim
  assert.equal(ctx.funil.length, 1);
  assert.equal(ctx.nKol + ctx.nRising + ctx.nPool, ctx.lista.length);
});

test("páginas de 20 somadas reproduzem a vista inteira, com filtros", () => {
  const { camp, rows, detalhe } = cenario();
  const ctx = prepararCasting(camp, rows, detalhe);
  for (const sp of [{}, { tipo: "kol" }, { tipo: "pool" }, { q: "ana julia" }, { q: "@CREATOR1" }, { tipo: "invalido" }]) {
    const { mostradas } = filtrarVista(ctx, sp);
    const juntas = [];
    for (let o = 0; o < mostradas.length; o += POR_PAGINA) juntas.push(...paginar(mostradas, o, POR_PAGINA));
    assert.deepEqual(juntas.map((r) => r.id), mostradas.map((r) => r.id), JSON.stringify(sp));
  }
  assert.equal(filtrarVista(ctx, { q: "ana julia" }).mostradas.length, 1);
  // a busca encontra a pessoa pelo @ da conta ligada
  assert.deepEqual(filtrarVista(ctx, { q: "creator11" }).mostradas.map((r) => r.creator_id), [uuid(10)]);
  assert.equal(filtrarVista(ctx, { tipo: "invalido" }).tipoFilter, null);
});

test("paginar e linhasIniciais saneiam limites e incluem a linha aberta", () => {
  const lista = Array.from({ length: 45 }, (_, i) => ({ id: i, creator_id: `c${i}` }));
  assert.equal(paginar([...lista, ...lista], 0, 999).length, 50); // teto MAX_POR_PAGINA
  assert.equal(paginar(lista, -5, 0).length, POR_PAGINA);
  assert.equal(paginar(lista, 40).length, 5);
  assert.equal(linhasIniciais(lista), 20);
  assert.equal(linhasIniciais(lista, "c19"), 20);
  assert.equal(linhasIniciais(lista, "c20"), 40);
  assert.equal(linhasIniciais(lista, "c44"), 45);
  assert.equal(linhasIniciais(lista, "nao-existe"), 20);
  assert.equal(linhasIniciais(lista.slice(0, 7)), 7);
});

test("resumo leve, card e exportação batem com a mesma linha", () => {
  const { camp, rows, detalhe } = cenario();
  const ctx = prepararCasting(camp, rows, detalhe);
  const r = ctx.lista.find((x) => x.creator_id === uuid(10));
  const resumo = resumoLinha(ctx, r);
  assert.deepEqual(Object.keys(resumo).sort(), ["avaliacao", "colunas", "creator", "reference", "rowId", "tag"]);
  assert.deepEqual(Object.keys(resumo.avaliacao).sort(), ["atingidos", "total"]);
  assert.equal(resumo.colunas.seguidores, "21k"); // 10k + 11k das duas contas
  assert.equal(resumo.colunas.er, "3,5%");
  const card = cardLinha(ctx, r);
  assert.equal(card.rowId, r.id);
  assert.match(card.contas, /@creator11/);
  assert.equal(card.numeros.find((n) => n.label === "Seguidores").sub, "2 contas somadas");
  const exp = exportCasting(ctx, ctx.lista);
  assert.equal(exp.length, ctx.lista.length);
  assert.equal(exp[ctx.lista.indexOf(r)].followers, resumo.colunas.seguidores);
});

test("card de uma linha só (montarCard) usa os nichos do radar para o território", () => {
  // sem pista no texto do briefing: o território vem do nicho mais comum do radar inteiro
  const { camp, rows, detalhe } = cenario({ camp: { name: "Briefing X", briefing: "", parsed: {} } });
  const cheio = prepararCasting(camp, rows, detalhe);
  const alvo = cheio.lista[3];
  const soAlvo = rows.filter((r) => r.creator_id === alvo.creator_id);
  const detAlvo = { ...detalhe, creators: detalhe.creators.filter((c) => c.id === alvo.creator_id) };
  const nichosRadar = cheio.radar.map((r) => cheio.cBy[r.creator_id].kol_screen.metricas.niche_bucket);
  const parcial = prepararCasting(camp, soAlvo, detAlvo, { nichosRadar });
  assert.equal(parcial.terrLabel, cheio.terrLabel);
  assert.deepEqual(cardLinha(parcial, parcial.lista[0]), cardLinha(cheio, alvo));
});
