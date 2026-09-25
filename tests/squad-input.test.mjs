import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSquadProfile, squadSearchTerm, squadItems, addSquadItems } from "../lib/squad-input.js";

const creator = "00000000-0000-4000-8000-000000000001";
test("links externos identificam rede e perfil, sem aceitar posts ou domínios parecidos", () => {
  assert.deepEqual(parseSquadProfile("https://www.instagram.com/Ana.Beauty/?utm_source=squad"), {
    platform: "instagram", handle: "ana.beauty", url: "https://www.instagram.com/ana.beauty/",
  });
  assert.deepEqual(parseSquadProfile("https://m.tiktok.com/@ANA_2"), {
    platform: "tiktok", handle: "ana_2", url: "https://www.tiktok.com/@ana_2",
  });
  assert.equal(parseSquadProfile("instagram.com/ana").url, "https://www.instagram.com/ana/");
  for (const value of [null, {}, "@ana", "http://instagram.com/ana", "https://instagram.com.evil.test/ana",
    "https://evilinstagram.com/ana", "https://user:pass@instagram.com/ana", "https://instagram.com/p/123",
    "https://instagram.com/reels", "https://tiktok.com/@ana/video/123", "https://tiktok.com/ana", "https://instagram.com/ana/other"]) {
    assert.equal(parseSquadProfile(value), null, String(value));
  }
});

test("busca conserva nomes brasileiros e remove sintaxe de filtros", () => {
  assert.equal(squadSearchTerm("@ana_beleza"), "ana_beleza");
  assert.equal(squadSearchTerm("  João da Conceição  "), "João da Conceição");
  assert.equal(/[,%()*\\]/.test(squadSearchTerm("ana%,id.not.is.null,(x)*\\")), false);
  assert.equal(squadSearchTerm("a".repeat(120)).length, 80);
});

test("adições deduplicam perfis, preservam redes por ID e rejeitam lotes inválidos", () => {
  assert.deepEqual(squadItems([{ creator_id: creator }, { creator_id: creator, prospect_id: "ignored" }, { prospect_id: "p1" }, { prospect_id: "p1" }]), [
    { creator_id: creator, prospect_id: null, match_score: null },
    { creator_id: null, prospect_id: "p1", match_score: null },
  ]);
  for (const items of [null, {}, [null], [{}], [{ creator_id: "not-id" }], [{ prospect_id: " " }], Array(501).fill({ creator_id: creator })]) {
    assert.throws(() => squadItems(items));
  }
});

test("resultado de inclusão exige confirmação e não ignora erro de banco", async () => {
  let called = false;
  const db = { rpc: async (name, args) => {
    called = true;
    assert.equal(name, "add_squad_items");
    assert.equal(args.p_list_id, creator);
    assert.equal(args.p_items.length, 1);
    return { data: 1, error: null };
  } };
  assert.equal(await addSquadItems(db, creator, [{ creator_id: creator }]), 1);
  assert.equal(called, true);
  for (const result of [{ data: 1, error: { message: "failed" } }, { data: null }, { data: -1 }]) {
    await assert.rejects(addSquadItems({ rpc: async () => result }, creator, []));
  }
});
