import { test } from "node:test";
import assert from "node:assert/strict";
import { squadProjection } from "../lib/squad-metrics.js";

const creator = (id, avg_views, eng_rate, followers = 1000) => ({
  id, creator_id: id, creator: { followers }, metrics: { avg_views, eng_rate },
});

test("E.R. da squad pondera pelas views e exclui taxas ausentes dos dois lados", () => {
  const result = squadProjection([
    creator("pequena", 1000, 10), creator("grande", 9000, 2),
    creator("sem-taxa", 5000, null), creator("sem-views", null, 90),
    { id: "prospect", prospect: { followers: 6000 }, metrics: { avg_views: 99999, eng_rate: 99 } },
  ]);
  assert.deepEqual(result, { views: 15000, eng: 280, base: 3, total: 5, er: 2.8000000000000003, erBase: 2, alcance: 10000, alcanceBase: 5 });
});

test("squad vazia e métricas desconhecidas ficam ausentes, não viram zero", () => {
  assert.deepEqual(squadProjection([]), { views: null, eng: null, base: 0, total: 0, er: null, erBase: 0, alcance: null, alcanceBase: 0 });
  const result = squadProjection([creator("sem", null, null, null)]);
  assert.equal(result.views, null);
  assert.equal(result.eng, null);
  assert.equal(result.er, null);
  assert.equal(result.alcance, null);
});

test("zero real permanece zero e nunca usa seguidores como denominador", () => {
  const zeroRate = squadProjection([creator("zero-taxa", 500, 0, 0)]);
  assert.equal(zeroRate.eng, 0);
  assert.equal(zeroRate.er, 0);
  assert.equal(zeroRate.alcance, 0);
  const zeroViews = squadProjection([creator("zero-views", 0, 10, 500000)]);
  assert.equal(zeroViews.views, 0);
  assert.equal(zeroViews.base, 1);
  assert.equal(zeroViews.er, null);
  assert.equal(zeroViews.eng, null);
});

test("remoção e inclusão recalculam as bases e resultados a partir dos membros atuais", () => {
  const ana = creator("ana", 1000, 5, 15000);
  const bia = creator("bia", 5000, 1, 35000);
  assert.equal(squadProjection([ana, bia]).eng, 100);
  assert.equal(squadProjection([ana]).er, 5);
  assert.equal(squadProjection([bia]).er, 1);
  assert.equal(squadProjection([bia]).alcance, 35000);
});

test("valores inválidos não contaminam a projeção; valores numéricos textuais são aceitos", () => {
  const result = squadProjection([
    creator("invalida", "NaN", -5, Infinity),
    creator("vazia", "", "", ""),
    creator("valida", "800", "2.5", "3000"),
  ]);
  assert.equal(result.views, 800);
  assert.equal(result.eng, 20);
  assert.equal(result.er, 2.5);
  assert.equal(result.alcance, 3000);
  assert.equal(result.base, 1);
  assert.equal(result.erBase, 1);
});
