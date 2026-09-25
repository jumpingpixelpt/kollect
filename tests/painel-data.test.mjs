import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createPainelLoader } from "../lib/painel-data.js";

const beforeStorage = globalThis.AsyncLocalStorage;
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { unstable_cache } = await import("next/cache.js");
if (beforeStorage === undefined) delete globalThis.AsyncLocalStorage;

test("painel: cache global de 60s, chave por dia UTC e falhas sem zeros persistidos", async (t) => {
  const before = globalThis.__incrementalCache;
  const entries = new Map();
  let now = 0;
  globalThis.__incrementalCache = {
    fetchCacheKey: async (key) => key,
    async get(key, { revalidate }) {
      const entry = entries.get(key);
      return entry && { value: entry.value, isStale: now - entry.at >= revalidate * 1000 };
    },
    async set(key, value) { entries.set(key, { value, at: now }); },
  };
  t.after(() => { globalThis.__incrementalCache = before; });
  let fail = false;
  let malformed = false;
  let total = 5223;
  const calls = [];
  const loader = createPainelLoader({ cache: unstable_cache, cacheKey: "fixture", db: {
    async rpc(name, args) {
      calls.push([name, args]);
      if (fail) return { error: { message: "indisponível" }, data: null };
      if (malformed) return { data: { funil: {} } };
      return { data: {
        termometro: { universo: 70000, qualificadas: 40000, comGrowth: 30000, noRadar: total, classes: { pool: total }, fontes: [] },
        funil: { universo: 68000, comAnalise: total, deHoje: args.p_hoje.endsWith("13") ? 100 : 0, noFunil: 62000 },
        termos: [{ termo: "cabelo", n: 100 }],
      } };
    },
  } });
  const today = "2026-09-13";
  fail = true;
  await assert.rejects(loader(today), /resumo do funil/);
  fail = false;
  malformed = true;
  await assert.rejects(loader(today), /resumo do funil/);
  malformed = false;
  assert.equal((await loader(today)).termometro.noRadar, 5223);
  total = 5224;
  now += 59000;
  assert.equal((await loader(today)).termometro.noRadar, 5223);
  assert.equal(calls.length, 3);
  now += 1001;
  assert.equal((await loader(today)).termometro.noRadar, 5224);
  assert.equal((await loader("2026-09-14")).funil.deHoje, 0);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0], ["painel_resumo", { p_hoje: today }]);
});
