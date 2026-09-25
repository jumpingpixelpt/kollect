import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSquadSnapshot, fetchSquads } from "../lib/squad-data.js";

function database({ failPage = false, missing = false } = {}) {
  const members = Array.from({ length: 1001 }, (_, id) => ({ id: `m${id}`, creator_id: `c${id}`, prospect_id: null, status: "concluida", list_id: "squad" }));
  const tables = {
    lists: missing ? [] : [{ id: "squad", name: "Exemplo", user_id: "owner-private", created_at: "2026-09-17" }],
    list_creators: members,
    leaderboard: members.map((member) => ({ id: member.creator_id, name: member.id, followers: 10, platform: "tiktok" })),
    prospects: [],
  };
  const db = {
    async rpc(name, args) {
      if (name === "page_counts") return { data: { lists: [{ id: "squad", total: 1001, concluida: 1001 }], campaigns: [], briefings: [] } };
      if (name === "campaign_creator_classes") return { data: args.p_creator_ids.map((id) => ({ id, kol_score: { geral: { elegivel: true, classe: "rising_star", score: 91 } } })) };
      if (name === "creator_latest_metrics") return { data: args.p_creator_ids.map((creator_id) => ({ creator_id, avg_views: 100, eng_rate: 5, captured_at: "2026-09-17", last_eng_rate: 8 })) };
      throw new Error(name);
    },
    from(table) {
      let rows = tables[table] || [];
      const q = {
        select() { return q; },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return q; },
        in(key, ids) { rows = rows.filter((row) => ids.includes(row[key])); return q; },
        order() { return q; },
        async range(from, to) { return failPage && table === "list_creators" && from > 0 ? { error: { message: "lost" } } : { data: rows.slice(from, to + 1) }; },
        async maybeSingle() { return { data: rows[0] || null }; },
      };
      return q;
    },
  };
  return db;
}

test("snapshot completa mais de 1000 membros e retorna métricas sem scores ou dados do dono", async () => {
  const snapshot = await fetchSquadSnapshot(database(), "squad");
  assert.equal(snapshot.items.length, 1001);
  assert.equal(snapshot.projection.views, 100100);
  assert.equal(snapshot.projection.eng, 5005);
  assert.equal(snapshot.projection.er, 5);
  assert.equal(snapshot.notifications.ownerKnown, true);
  assert.equal(snapshot.items[1000].tag, "rising_star");
  assert.equal(snapshot.items[0].metrics.eng_rate, 5);
  const json = JSON.stringify(snapshot);
  for (const field of ["owner-private", "kol_score", "last_eng_rate", '"score"']) assert.equal(json.includes(field), false, field);
});

test("leitura parcial falha e squad ausente não vira grupo vazio", async () => {
  await assert.rejects(fetchSquadSnapshot(database({ failPage: true }), "squad"));
  assert.equal(await fetchSquadSnapshot(database({ missing: true }), "squad"), null);
});

test("índice usa contagens completas e só expõe campos da lista", async () => {
  const lists = await fetchSquads(database());
  assert.equal(lists[0].total, 1001);
});
