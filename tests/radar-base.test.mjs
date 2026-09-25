import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRadarBase } from "../lib/radar-base.js";
import { fetchRadarSource } from "../lib/radar-source.js";
import { inBand, matchClassificacao, bySort } from "../lib/list-filters.js";

const creator = (id, dados = {}) => ({
  id, name: id, handle: id, platform: "instagram", followers: 1000,
  person_key: null, total: 50, kol_nota: null, kol_classe: null,
  niche: null, category: null, ...dados,
});
const fonte = (dados = {}) => ({ creators: [], bhRows: [], seriesRows: [], vstats: [], ...dados });

test("contas ligadas: principal pelo Radar, alcance e filtros de todas as redes", () => {
  const base = assembleRadarBase(fonte({
    // A irmã aparece primeiro e tem mais KOL; nenhuma dessas coisas a torna principal.
    creators: [
      creator("irma", { person_key: "ana", name: "𝑨𝑵𝑨 Cachos", handle: "ana.cachos", platform: "tiktok", followers: 40000, total: 40, kol_nota: 95, kol_classe: "kol" }),
      creator("principal", { person_key: "ana", name: "Ana Ávila", handle: "ana.avila", followers: 30000, total: 85, bio: "Minha bio principal" }),
    ],
    bhRows: [
      { id: "principal", territorio: "cabelo", brand_history: { sub_nichos: ["Coloração"], formatos: ["Tutorial"] } },
      { id: "irma", territorio: "skincare", brand_history: {
        marcas: [{ marca: "Ruby Rose", categoria: "beleza" }],
        sub_nichos: [{ sub_nicho: "Cacheado e crespo" }, { nome: "Coloração" }],
        formatos: [{ formato: "Resenha" }, { nome: "Tutorial" }],
      } },
    ],
    vstats: [{ creator_id: "principal", eng_per_post: 100, views_per_post: 2000 }, { creator_id: "irma", eng_per_post: 900, views_per_post: 10000 }],
  }));
  assert.equal(base.allUnfiltered.length, 1);
  const pessoa = base.allUnfiltered[0];
  assert.equal(pessoa.id, "principal");
  assert.equal(pessoa.platform, "instagram");
  assert.equal(pessoa.bio, "Minha bio principal");
  assert.equal(pessoa.territorio, "cabelo");
  assert.equal(pessoa.eng_per_post, 100);
  assert.equal(pessoa.followers_combined, 70000);
  assert.equal(inBand(pessoa.followers_combined, "50_200"), true);
  assert.equal(pessoa.classe, null);
  assert.equal(matchClassificacao(pessoa, "pool"), false);
  assert.deepEqual(pessoa.accounts.map((a) => a.id).sort(), ["irma", "principal"]);
  assert.deepEqual(pessoa.brand_keys, ["rubyrose"]);
  assert.deepEqual(new Set(pessoa.subnicho_keys), new Set(["coloracao", "cacheadoecrespo"]));
  assert.deepEqual(new Set(pessoa.formato_keys), new Set(["tutorial", "resenha"]));
  assert.deepEqual(base.brandOpts, [["rubyrose", "Ruby Rose"]]);
  assert.ok(pessoa._hs.includes("ana.cachos"));
  assert.match(pessoa._s, /ana cachos/);
  assert.match(pessoa._s, /ana avila/);
  assert.match(pessoa._c, /cacheado e crespo/);
  assert.match(pessoa._c, /skincare/);
});

test("marcas: aliases deduplicados, categoria preservada e exclusões de beleza", () => {
  const base = assembleRadarBase(fonte({
    creators: [creator("marcas")],
    bhRows: [{ id: "marcas", brand_history: { marcas: [
      { marca: "Elseve", categoria: "beleza" },
      { marca: "L'Oréal Paris", categoria: "beleza" },
      { marca: "Flor Serena", categoria: "beleza" }, // conhecida pela análise, não pelo nome
      { marca: "Dove", categoria: "outra" },
      { marca: "Misci", categoria: "beleza" }, // exclusão prevalece sobre a análise
      { marca: "Protetor Solar FPS 70", categoria: "beleza" },
      { marca: "Marca indecifrável" },
      { marca: "Pantene Brasil" }, // legado, marca reconhecida sem categoria
    ] } }],
  }));
  assert.deepEqual(new Set(base.allUnfiltered[0].brand_keys), new Set(["lorealparis", "florserena", "pantene"]));
  assert.deepEqual(base.brandOpts.map(([chave]) => chave), ["florserena", "lorealparis", "pantene"]);
});

test("território: guardado, bucket, conteúdo analisado e ausência de evidência", () => {
  const base = assembleRadarBase(fonte({
    creators: ["guardado", "cilios", "estetica", "viagem", "sem_leitura", "texto", "nicho"].map((id) => creator(id, id === "texto" ? { category: "Skincare" } : {})),
    bhRows: [
      { id: "guardado", territorio: "perfume", kol_screen: { metricas: { niche_bucket: "cabelo" } } },
      { id: "cilios", kol_screen: { metricas: { niche_bucket: "cilios" } } },
      { id: "estetica", kol_screen: { metricas: { niche_bucket: "estetica" } } },
      { id: "viagem", brand_history: { nichos: [{ nicho: "Viagens", pct: 100 }] } },
      { id: "nicho", brand_history: { nichos: [{ nicho: "Cabelo", pct: 20 }, { nicho: "Maquiagem", pct: "80" }], sub_nichos: [{ nome: "Olhos" }, "Batom"] } },
    ],
  }));
  const porId = Object.fromEntries(base.allUnfiltered.map((c) => [c.id, c]));
  assert.equal(porId.guardado.territorio, "perfume");
  assert.equal(porId.cilios.territorio, "maquiagem");
  assert.equal(porId.estetica.territorio, "skincare");
  assert.equal(porId.viagem.territorio, "lifestyle");
  assert.equal(porId.sem_leitura.territorio, null);
  assert.equal(porId.texto.territorio, "skincare");
  assert.equal(porId.nicho.territorio, "maquiagem");
  assert.equal(porId.nicho.top_nicho.nicho, "Maquiagem");
  assert.equal(porId.nicho.top_subnicho, "Olhos");
});

test("ordem padrão: nota KOL zero precede Radar alto, nulo não herda classe antiga", () => {
  const base = assembleRadarBase(fonte({
    creators: [
      creator("radar_alto", { total: 99 }),
      creator("zero_kol", { total: 1, kol_nota: 0, kol_classe: "elegivel" }),
      creator("kol", { total: 10, kol_nota: 80, kol_classe: "kol" }),
      creator("radar_baixo", { total: 20 }),
    ],
    bhRows: [{ id: "radar_alto", kol_screen: { classe: "kol", is_kol: true } }],
  }));
  assert.deepEqual(base.allUnfiltered.map((c) => c.id), ["kol", "zero_kol", "radar_alto", "radar_baixo"]);
  const radar = base.allUnfiltered.find((c) => c.id === "radar_alto");
  assert.equal(radar.classe, null);
  assert.equal(radar.is_kol, false);
  assert.equal(matchClassificacao(base.allUnfiltered[1], "pool"), true);
});

test("forecast e métricas usam a série completa; snapshot sem taxa não apaga a leitura anterior", () => {
  const dias = [0, 10, 25, 60, 90];
  const snaps = dias.map((dia, i) => ({
    captured_at: new Date(Date.UTC(2026, 0, 1) + dia * 864e5).toISOString(),
    followers: Math.round(10000 * Math.exp(0.005 * dia)),
    avg_views: 1000 + i * 1000,
    eng_rate: i === dias.length - 1 ? null : 5,
  }));
  const [c] = assembleRadarBase(fonte({
    creators: [creator("crescendo")],
    seriesRows: [{ creator_id: "crescendo", snaps }],
    vstats: [{ creator_id: "crescendo", eng_per_post: null, views_per_post: 2000 }],
  })).allUnfiltered;
  assert.equal(c.classification, "rising");
  assert.equal(c.fc.direction, "crescer");
  assert.equal(c.fc.confidence, "alta");
  assert.ok(c.fc.delta30 >= 16 && c.fc.delta30 <= 16.4);
  assert.equal(c.eng_rate, 5);
  assert.equal(c.avg_views, 5000);
  assert.equal(c.views_per_post, 2000);
  assert.equal(c.eng_per_post, 100);
});

test("métricas: zero é uma medida; sem views não se inventa engajamento por seguidores", () => {
  const base = assembleRadarBase(fonte({
    creators: [creator("zero"), creator("sem_views", { followers: 1000000 }), creator("medido")],
    seriesRows: [
      { creator_id: "zero", snaps: [
        { captured_at: "2026-09-01", followers: 1000, avg_views: 1000, eng_rate: 5 },
        { captured_at: "2026-09-02", followers: 1100, avg_views: 1000, eng_rate: 0 },
      ] },
      { creator_id: "sem_views", snaps: [{ captured_at: "2026-09-01", followers: 1000000, avg_views: null, eng_rate: 5 }] },
      { creator_id: "medido", snaps: [{ captured_at: "2026-09-01", followers: 1000, avg_views: 1000, eng_rate: 5 }] },
    ],
    vstats: [
      { creator_id: "zero", views_per_post: 500, eng_per_post: null },
      { creator_id: "medido", views_per_post: "1200", eng_per_post: "37.5" },
    ],
  }));
  const porId = Object.fromEntries(base.allUnfiltered.map((c) => [c.id, c]));
  assert.equal(porId.zero.eng_rate, 0);
  assert.equal(porId.zero.eng_per_post, 0);
  assert.equal(porId.sem_views.eng_per_post, null);
  assert.equal(porId.sem_views.views_per_post, null);
  assert.equal(porId.medido.eng_per_post, 37.5);
  assert.equal(porId.medido.views_per_post, 1200);
  assert.equal(porId.zero.fc, null);
  for (const direcao of ["asc", "desc"]) {
    const ordenados = [...base.allUnfiltered].sort(bySort("eng", direcao));
    assert.equal(ordenados.at(-1).id, "sem_views");
    assert.equal(ordenados[0].id, direcao === "asc" ? "zero" : "medido");
  }
});

test("modo light mantém agrupamento e classes sem exigir séries ou métricas", () => {
  const base = assembleRadarBase(fonte({
    creators: [
      creator("principal", { person_key: "pessoa", total: 80, kol_nota: 75, kol_classe: "rising_star" }),
      creator("irma", { person_key: "pessoa", total: 20 }),
    ],
  }), { light: true });
  const [c] = base.allUnfiltered;
  assert.equal(base.allUnfiltered.length, 1);
  assert.equal(c.is_rising_star, true);
  assert.equal(c.followers_combined, 2000);
  assert.equal(c.classification, null);
  assert.equal(c.fc, null);
  assert.equal(c.eng_per_post, null);
});

test("fonte escalar e montagem conservam mais de 1000 creators numa só leitura", async () => {
  const dados = fonte({ creators: Array.from({ length: 1003 }, (_, i) => creator(`creator_${i}`)) });
  let leituras = 0;
  const db = { rpc: async () => { leituras++; return { data: dados, error: null }; } };
  const recebida = await fetchRadarSource(db);
  const base = assembleRadarBase(recebida);
  assert.equal(leituras, 1);
  assert.equal(base.allUnfiltered.length, 1003);
  assert.ok(base.allUnfiltered.some((c) => c.id === "creator_1002"));
});

test("fonte rejeita resposta parcial, mas aceita uma base vazia válida", async () => {
  for (const chave of ["creators", "bhRows", "seriesRows", "vstats"]) {
    const parcial = fonte();
    delete parcial[chave];
    await assert.rejects(fetchRadarSource({ rpc: async () => ({ data: parcial, error: null }) }), /resposta incompleta/);
  }
  await assert.rejects(fetchRadarSource({ rpc: async () => ({ data: null, error: null }) }), /resposta incompleta/);
  await assert.rejects(fetchRadarSource({ rpc: async () => ({ data: fonte({ creators: {} }), error: null }) }), /resposta incompleta/);
  const vazia = await fetchRadarSource({ rpc: async () => ({ data: fonte(), error: null }) });
  assert.deepEqual(assembleRadarBase(vazia).allUnfiltered, []);
});

test("falha de leitura não vira sucesso parcial e permite nova tentativa", async () => {
  let leituras = 0;
  const db = { rpc: async () => {
    leituras++;
    return leituras === 1
      ? { data: fonte({ creators: [creator("parcial")] }), error: { message: "consulta indisponível" } }
      : { data: fonte({ creators: [creator("recuperado")] }), error: null };
  } };
  await assert.rejects(fetchRadarSource(db), /consulta indisponível/);
  const base = assembleRadarBase(await fetchRadarSource(db));
  assert.equal(leituras, 2);
  assert.deepEqual(base.allUnfiltered.map((c) => c.id), ["recuperado"]);
});
