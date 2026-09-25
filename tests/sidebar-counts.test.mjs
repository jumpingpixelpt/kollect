import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createSidebarCountLoader } from "../lib/sidebar-counts.js";

// O bootstrap do Next expõe AsyncLocalStorage antes de carregar next/cache.
const previousStorage = globalThis.AsyncLocalStorage;
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { unstable_cache } = await import("next/cache.js");
if (previousStorage === undefined) delete globalThis.AsyncLocalStorage;

function fixture(t) {
  const previous = globalThis.__incrementalCache;
  const entries = new Map();
  let now = 0;
  // O adapter real do Next, com armazenamento local e relógio controlável.
  // Não há rede, sessão nem Supabase neste teste.
  globalThis.__incrementalCache = {
    fetchCacheKey: async (key) => key,
    async get(key, { revalidate }) {
      const entry = entries.get(key);
      return entry && { value: entry.value, isStale: now - entry.at >= revalidate * 1000 };
    },
    async set(key, value) { entries.set(key, { value, at: now }); },
  };
  t.after(() => { globalThis.__incrementalCache = previous; });

  const queries = [];
  const values = { prospects: 68000, briefings: 2 };
  const failures = new Set();
  const db = {
    from(table) {
      const query = {
        table, filters: [],
        select(column, options) { this.column = column; this.options = options; return this; },
        not(...args) { this.filters.push(args); return this; },
        then(resolve, reject) {
          queries.push({ ...this });
          return Promise.resolve(failures.has(table) ? { count: null, error: { message: "indisponível" } } : { count: values[table], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const loader = createSidebarCountLoader({ db, cache: unstable_cache, cacheKey: "fixture-sidebar" });
  return { loader, queries, values, failures, advance: (ms) => { now += ms; } };
}

// B3.2 (set/2026): só se contam os badges que a Sidebar mostra (prospects, briefings) —
// creators, squads e campanhas deixaram de ser consultados a cada navegação.
test("sidebar: só conta prospects e briefings, com o filtro das Descobertas", async (t) => {
  const { loader, queries } = fixture(t);
  const c = await loader();
  assert.deepEqual(c, { prospects: 68000, briefings: 2 });
  assert.deepEqual(queries.map((q) => q.table).sort(), ["briefings", "prospects"]);
  const prospects = queries.find((q) => q.table === "prospects");
  assert.equal(prospects.column, "tubular_id");
  assert.deepEqual(prospects.filters, [["status", "like", "sem_handle:irrecuperavel%"]]);
  for (const q of queries) assert.deepEqual(q.options, { count: "exact", head: true });
});

test("sidebar: contagens globais são reutilizadas e renovam após 60 segundos", async (t) => {
  const { loader, values, queries, advance } = fixture(t);
  assert.equal((await loader()).prospects, 68000);
  values.prospects = 68001;
  advance(59000);
  assert.equal((await loader()).prospects, 68000);
  advance(1001);
  assert.equal((await loader()).prospects, 68001);
  assert.equal(queries.filter((q) => q.table === "prospects").length, 2);
});

test("sidebar: falha de contagem não vira zero cacheado nem esconde outros badges", async (t) => {
  const { loader, values, failures, queries } = fixture(t);
  failures.add("prospects");
  const failed = await loader();
  assert.equal(failed.prospects, null);
  assert.equal(failed.briefings, 2);
  failures.delete("prospects");
  values.prospects = 0;
  assert.equal((await loader()).prospects, 0);
  assert.equal((await loader()).prospects, 0);
  assert.equal(queries.filter((q) => q.table === "prospects").length, 2);
});
