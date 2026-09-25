// Medição somente leitura do radar no Supabase configurado em .env.local.
// Não chama pipelines nem grava dados. Saída: tempos, volumes e contagens; sem perfis/chaves.
// node scripts/medir-radar.mjs [--stable-only]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { assembleRadarBase } from '../lib/radar-base.js';
import { fetchRadarSource } from '../lib/radar-source.js';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
require('@next/env').loadEnvConfig(projectRoot, false, { info() {}, error() {} });
const { createClient } = require('@supabase/supabase-js');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rpwkwulugrwxkzqudkeu.supabase.co';
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Service role local indisponível');
let requests = 0;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => { requests++; return fetch(input, { ...init, cache: 'no-store' }); } },
});

async function all(build) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function measure(name, read) {
  requests = 0;
  const start = performance.now();
  const data = await read();
  const fetched = performance.now();
  const assembled = assembleRadarBase(data);
  const end = performance.now();
  console.log(JSON.stringify({ name, fetchMs: Math.round(fetched-start), assembleMs: Math.round(end-fetched), requests,
    payloadBytes: Buffer.byteLength(JSON.stringify(data)), creators: data.creators.length, people: assembled.allUnfiltered.length }));
  return { data, assembled };
}

const readOld = async (stable = false) => {
  const [creators, bhRows, seriesRows, vstats] = await Promise.all([
    all(() => { const q = db.from('leaderboard').select('*').order('total', { ascending: false }); return stable ? q.order('id') : q; }),
    all(() => { const q = db.from('creators').select('id, brand_history, kol_screen, territorio, kol_classe:kol_score->geral->>classe'); return stable ? q.order('id') : q; }),
    all(() => { const q = db.from('creator_snapshot_series').select('creator_id, snaps'); return stable ? q.order('creator_id') : q; }),
    all(() => { const q = db.from('creator_video_stats').select('creator_id, eng_per_post, views_per_post'); return stable ? q.order('creator_id') : q; }),
  ]);
  return { creators, bhRows, seriesRows, vstats };
};
const originalRead = process.argv.includes('--stable-only') ? null : await measure('baseline-paginado-original', () => readOld());
const old = await measure('baseline-paginado-desempate-id', () => readOld(true));
const original = originalRead || old;
console.log(JSON.stringify({ originalUniqueCreators: new Set(original.data.creators.map(c => c.id)).size, stableUniqueCreators: new Set(old.data.creators.map(c => c.id)).size, duplicateOriginalRows: original.data.creators.length-new Set(original.data.creators.map(c => c.id)).size }));
const next = await measure('rpc-compacta', () => fetchRadarSource(db));
for (const key of ['seriesRows','vstats']) console.log(JSON.stringify({ part: key, beforeRows: original.data[key].length, beforeUnique: new Set(original.data[key].map(r=>r.creator_id)).size, afterRows: next.data[key].length, afterUnique: new Set(next.data[key].map(r=>r.creator_id)).size }));

// Compara todos os campos mantidos na montagem nova, contra a leitura antiga com
// desempate estável: o OFFSET sem ordem única repetia/omitia creators e agregados.
// Só ignora colunas antigas que nunca eram consumidas pela lista.
const before = new Map(old.assembled.allUnfiltered.map(row => [row.id, row]));
const mismatches = [];
for (const row of next.assembled.allUnfiltered) {
  const prev = before.get(row.id);
  if (!prev) { mismatches.push({ field: 'primary-id' }); continue; }
  for (const [field, value] of Object.entries(row)) {
    const normalize = (x) => Array.isArray(x) && ['accounts','brand_keys','subnicho_keys','formato_keys','_hs'].includes(field)
      ? [...x].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : x;
    try { assert.deepEqual(normalize(value), normalize(prev[field])); }
    catch { mismatches.push({ field }); }
  }
}
for (const key of ['brandOpts','subnichoOpts','formatoOpts','topNicho']) {
  try { assert.deepEqual(next.assembled[key], old.assembled[key]); }
  catch { mismatches.push({ field: key }); }
}
const mismatchCounts = {};
for (const {field} of mismatches) mismatchCounts[field] = (mismatchCounts[field] || 0) + 1;
console.log(JSON.stringify({ mismatchCounts, originalPeople: original.assembled.allUnfiltered.length, stablePeople: old.assembled.allUnfiltered.length, newPeople: next.assembled.allUnfiltered.length }));
assert.equal(next.data.creators.length, old.data.creators.length);
assert.equal(next.assembled.allUnfiltered.length, old.assembled.allUnfiltered.length);
console.log(JSON.stringify({ comparedPeople: next.assembled.allUnfiltered.length, mismatchCounts }));
if (mismatches.length) process.exitCode = 1;
