import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleRadarBase } from "../lib/radar-base.js";
import { compactarBase, baseDoPayload, slimRow, RADAR_CACHE_VERSAO } from "../lib/radar-compacto.js";
import { inBand, inTier, matchClassificacao, sortVal, SORT_KEYS, TIERS, BANDS } from "../lib/list-filters.js";

const creator = (id, dados = {}) => ({
  id, name: id, handle: id, platform: "instagram", followers: 1000, avatar_url: "https://cdninstagram.com/x.jpg",
  person_key: null, total: 50, kol_nota: null, kol_classe: null, niche: null, category: null, ...dados,
});

const fonte = {
  creators: [
    creator("a1", { person_key: "ana", name: "Ana Ávila", handle: "ana.avila", followers: 30000, total: 85, bio: "bio", kol_nota: 71, kol_classe: "kol", janela_aberta: true, cache_per_video: 900 }),
    creator("a2", { person_key: "ana", handle: "ana.tt", platform: "tiktok", followers: 250000, total: 40 }),
    creator("b", { name: "Bia", handle: "bia", followers: 5000, total: 60, kol_classe: "hidden_gem" }),
    creator("c", { name: "Caio", handle: "caio", followers: 2e6, total: 20 }),
  ],
  bhRows: [
    { id: "a1", territorio: "cabelo", brand_history: { nichos: [{ nicho: "Cabelo", pct: 80 }], sub_nichos: ["Coloração"], formatos: ["Tutorial"], marcas: [{ marca: "Elsève", categoria: "cabelo" }] } },
    { id: "a2", brand_history: { sub_nichos: [{ nome: "Cacheado" }], formatos: [{ formato: "Resenha" }], marcas: [{ marca: "Garnier", categoria: "beleza" }] } },
    { id: "b", brand_history: { sub_nichos: ["Coloração"], marcas: [{ marca: "Garnier", categoria: "beleza" }] } },
  ],
  seriesRows: [
    { creator_id: "a1", snaps: [{ captured_at: "2026-09-01", followers: 29000, avg_views: 1000, eng_rate: 4 }, { captured_at: "2026-09-10", followers: 30000, avg_views: 1500, eng_rate: null }] },
    { creator_id: "c", snaps: [{ captured_at: "2026-09-10", followers: 2e6, avg_views: 90000, eng_rate: 2.5 }] },
  ],
  vstats: [{ creator_id: "b", eng_per_post: 321.5, views_per_post: 4000 }],
};

test("base da tabela = base viva: mesmas linhas, mesma ordem, mesmos filtros e ordenações", () => {
  const viva = assembleRadarBase(fonte);
  // ida e volta pelo JSON, como na tabela radar_cache
  const payload = JSON.parse(JSON.stringify(compactarBase(viva)));
  assert.equal(payload.v, RADAR_CACHE_VERSAO);
  const cache = baseDoPayload(payload);

  assert.deepEqual(cache.allUnfiltered.map((c) => c.id), viva.allUnfiltered.map((c) => c.id));
  for (const k of ["brandOpts", "subnichoOpts", "subnichoTopOpts", "formatoOpts"]) assert.deepEqual(cache[k], viva[k]);

  for (let i = 0; i < viva.allUnfiltered.length; i++) {
    const v = viva.allUnfiltered[i], c = cache.allUnfiltered[i];
    // tudo o que lib/radar-data.js lê de uma linha para filtrar e procurar
    for (const k of ["platform", "territorio", "classe", "is_kol", "is_rising_star", "janela_aberta", "followers", "followers_combined",
      "brand_keys", "subnicho_keys", "formato_keys", "_s", "_c", "_hs", "accounts"]) {
      assert.deepEqual(c[k], v[k], `${v.id}.${k}`);
    }
    for (const k of SORT_KEYS) assert.equal(sortVal(c, k), sortVal(v, k), `${v.id} sort ${k}`);
    for (const [t] of TIERS) assert.equal(inTier(c, t), inTier(v, t));
    for (const [b] of BANDS) assert.equal(inBand(c.followers_combined ?? c.followers, b), inBand(v.followers_combined ?? v.followers, b));
    for (const l of ["kol", "pool", "janela", "rising_star", "hidden_gem"]) assert.equal(matchClassificacao(c, l), matchClassificacao(v, l));
    // o que vai para o cliente é igual (slimRow aplicado à linha viva ou à da tabela)
    assert.deepEqual(JSON.parse(JSON.stringify(slimRow(c))), JSON.parse(JSON.stringify(slimRow(v))));
  }
});

test("chaves de filtro gravam-se como posições e voltam a texto", () => {
  const viva = assembleRadarBase(fonte);
  const payload = compactarBase(viva);
  const ana = payload.rows.find((r) => r.id === "a1");
  assert.ok(ana.brand_keys.every((k) => typeof k === "number"));
  assert.ok(ana.brand_keys.length > 0);
  assert.deepEqual(baseDoPayload(payload).allUnfiltered.find((r) => r.id === "a1").brand_keys,
    viva.allUnfiltered.find((r) => r.id === "a1").brand_keys);
});

test("formato de outra versão não é servido (quem lê remonta)", () => {
  assert.equal(baseDoPayload({ v: RADAR_CACHE_VERSAO + 1, rows: [] }), null);
  assert.equal(baseDoPayload(null), null);
});

test("o cliente não recebe o URL do avatar, o forecast nem os índices de filtro", () => {
  const r = slimRow({ ...assembleRadarBase(fonte).allUnfiltered[0], brand_keys: ["x"], _s: "x" });
  for (const k of ["avatar_url", "fc", "classification", "brand_keys", "_s", "_c", "_hs"]) assert.equal(k in r, false, k);
});
