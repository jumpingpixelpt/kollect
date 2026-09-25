import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPageIds, fetchPageCounts, fetchCreatorLatestMetrics, fetchCampaignCreatorClasses } from "../lib/page-data.js";
import { classeDe, contaNoCasting, tagDaFicha } from "../lib/casting.js";

test("IDs são deduplicados e carregados em lotes de 150, no máximo quatro de cada vez", async () => {
  let active = 0, peak = 0;
  const batches = [];
  const ids = Array.from({ length: 901 }, (_, id) => id);
  const rows = await fetchPageIds((part) => ({
    async range(from, to) {
      assert.equal(from, 0);
      assert.equal(to, 999);
      batches.push(part);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      return { data: part.map((id) => ({ id })), error: null };
    },
  }), [...ids, null, 4, 900]);
  assert.deepEqual(rows.map((r) => r.id), ids);
  assert.equal(batches.length, 7);
  assert.ok(batches.every((part) => part.length <= 150));
  assert.equal(peak, 4);
});

test("um lote de campanhas pode ter mais de 1000 membros; erro não devolve uma lista parcial", async () => {
  const members = Array.from({ length: 1003 }, (_, id) => ({ id }));
  const make = (fail = false) => () => ({ range: async (from, to) =>
    fail && from > 0 ? { data: null, error: { message: "falhou" } } : { data: members.slice(from, to + 1), error: null },
  });
  assert.equal((await fetchPageIds(make(), ["campanha"])).length, 1003);
  await assert.rejects(fetchPageIds(make(true), ["campanha"]));
});

test("sem IDs não consulta a base; contagens e métricas rejeitam erros e respostas incompletas", async () => {
  const unused = { rpc: () => { throw new Error("não devia consultar"); } };
  assert.deepEqual(await fetchPageIds(() => { throw new Error("não devia consultar"); }, []), []);
  assert.deepEqual(await fetchCreatorLatestMetrics(unused, []), []);
  assert.deepEqual(await fetchCampaignCreatorClasses(unused, []), []);
  assert.deepEqual(await fetchPageCounts(unused), { campaigns: [], lists: [], briefings: [] });
  const ok = { campaigns: [], lists: [], briefings: [] };
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: ok, error: null }; } };
  assert.deepEqual(await fetchPageCounts(db, { campaignIds: ["visivel"] }), ok);
  assert.deepEqual(calls, [{ name: "page_counts", args: { p_campaign_ids: ["visivel"], p_list_ids: [], p_briefing_ids: [] } }]);
  for (const data of [null, {}, { campaigns: [], lists: [] }, { ...ok, briefings: null }]) {
    await assert.rejects(fetchPageCounts({ rpc: async () => ({ data }) }, { listIds: ["lista"] }));
  }
  await assert.rejects(fetchPageCounts({ rpc: async () => ({ data: ok, error: { message: "falhou" } }) }, { briefingIds: ["brief"] }));
  await assert.rejects(fetchCreatorLatestMetrics({ rpc: async () => ({ data: {}, error: null }) }, ["creator"]));
  await assert.rejects(fetchCreatorLatestMetrics({ rpc: async () => ({ data: [], error: { message: "falhou" } }) }, ["creator"]));
  await assert.rejects(fetchCampaignCreatorClasses({ rpc: async () => ({ data: null, error: null }) }, ["creator"]));
  await assert.rejects(fetchCampaignCreatorClasses({ rpc: async () => ({ data: [], error: { message: "falhou" } }) }, ["creator"]));
});

test("última linha e última métrica observada ficam distintas: zero não vira ausência", async () => {
  const rows = [
    { creator_id: "ana", captured_at: "2026-09-14", avg_views: null, eng_rate: null, last_avg_views: 500, last_eng_rate: 7 },
    { creator_id: "bia", captured_at: "2026-09-14", avg_views: 0, eng_rate: 0, last_avg_views: 0, last_eng_rate: 0 },
  ];
  const result = await fetchCreatorLatestMetrics({ rpc: async (name, args) => {
    assert.equal(name, "creator_latest_metrics");
    assert.deepEqual(args, { p_creator_ids: ["ana", "bia"] });
    return { data: rows, error: null };
  } }, ["ana", "ana", "bia", null]);
  assert.deepEqual(result, rows);
  assert.equal(result[0].eng_rate, null);
  assert.equal(result[0].last_eng_rate, 7);
  assert.equal(result[1].eng_rate, 0);
});

test("classes compactas conservam ramo ausente, ramo vazio, elegibilidade e exceção manual", async () => {
  const rows = [
    { id: "legado", kol_score: { geral: null, masculino: { classe: "rising_star", elegivel: true } }, kol_screen: { classe: "kol", disaster: { nivel: "alto" } } },
    { id: "calculado_sem_classe", kol_score: { geral: { classe: null, elegivel: null }, masculino: null }, kol_screen: { classe: "kol", disaster: { nivel: "medio" } } },
    { id: "inelegivel", kol_score: { geral: { classe: "kol", elegivel: false } }, kol_screen: { classe: "kol" } },
  ];
  const result = await fetchCampaignCreatorClasses({ rpc: async (name, args) => {
    assert.equal(name, "campaign_creator_classes");
    assert.deepEqual(args, { p_creator_ids: rows.map((r) => r.id) });
    return { data: rows, error: null };
  } }, [...rows.map((r) => r.id), "legado"]);
  assert.equal(classeDe({}, result[0]), "kol");
  assert.equal(classeDe({}, result[0], "masculino"), "rising_star");
  assert.equal(classeDe({}, result[1]), "promissora");
  assert.equal(tagDaFicha(result[0]), null);
  assert.equal(tagDaFicha(result[2]), "pool");
  assert.equal(contaNoCasting({ kind: "kol" }, result[0]), false);
  assert.equal(contaNoCasting({ kind: "manual" }, result[0]), true);
  assert.equal(contaNoCasting({ kind: "kol" }, result[1]), true);
});
