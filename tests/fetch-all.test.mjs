import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows } from "../lib/fetch-all.js";

test("paginação estrita: preserva mais de mil registros e rejeita falha intermediária", async () => {
  const data = Array.from({ length: 2001 }, (_, id) => ({ id }));
  const ranges = [];
  let failAt = null;
  const build = () => ({ async range(from, to) {
    ranges.push([from, to]);
    return from === failAt ? { data: null, error: { message: "falha" } } : { data: data.slice(from, to + 1), error: null };
  } });
  assert.deepEqual(await fetchAllRows(build, { strict: true }), data);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  failAt = 1000;
  await assert.rejects(fetchAllRows(build, { strict: true }), /todos os registros/);
  // Rotas legadas mantêm a semântica anterior até migrarem explicitamente.
  assert.equal((await fetchAllRows(build)).length, 1000);
});
