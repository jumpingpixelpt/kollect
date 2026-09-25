import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createSessionReaders } from "../lib/session-data.js";

// React que o Next 14 usa nos Server Components; o dispatcher representa o
// armazenamento de UMA renderização. Não há cookies, contas reais ou rede.
const require = createRequire(import.meta.url);
const React = require("next/dist/compiled/react/react.react-server.js");
const currentCache = React.__SECRET_SERVER_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentCache;
async function request(run) {
  const before = currentCache.current;
  const entries = new Map();
  currentCache.current = { getCacheForType(type) {
    if (!entries.has(type)) entries.set(type, type());
    return entries.get(type);
  } };
  try { return await run(); } finally { currentCache.current = before; }
}

test("sessão: layout e página deduplicam leituras; outro pedido relê usuário e papel", async () => {
  let user = { id: "ana", email: "ana@example.test" };
  const roles = { ana: "admin", bia: "operador" };
  const calls = { user: 0, role: [] };
  const readers = createSessionReaders({
    cache: React.cache,
    async readUser() { calls.user++; return user; },
    async readRole(id) { calls.role.push(id); return roles[id]; },
  });
  await request(async () => {
    const [layout, page, profile] = await Promise.all([
      readers.sessionRole(), readers.sessionRole(), readers.sessionUser(),
    ]);
    assert.equal(layout, page);
    assert.equal(layout.user, profile);
    assert.equal(layout.role, "admin");
    assert.deepEqual(calls, { user: 1, role: ["ana"] });
  });
  user = { id: "bia" };
  assert.equal((await request(() => readers.sessionRole())).user.id, "bia");
  user = { id: "ana" };
  roles.ana = "operador";
  assert.equal((await request(() => readers.sessionRole())).role, "operador");
  assert.deepEqual(calls, { user: 3, role: ["ana", "bia", "ana"] });
  user = null;
  assert.deepEqual(await request(() => readers.sessionRole()), { user: null, role: null });
  assert.equal(calls.role.length, 3);
});

test("sessão: fora de RSC não há reutilização; usuário sem papel continua operador", async () => {
  let calls = 0;
  const { sessionRole } = createSessionReaders({
    cache: React.cache,
    async readUser() { calls++; return { id: "sem-papel" }; },
    async readRole() { return null; },
  });
  assert.equal((await sessionRole()).role, "operador");
  assert.equal((await sessionRole()).role, "operador");
  assert.equal(calls, 2);
});
