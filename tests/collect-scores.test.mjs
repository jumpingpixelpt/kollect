import { test } from "node:test";
import assert from "node:assert/strict";
import { squadScoreTargets, refreshCollectionScores } from "../lib/collect-scores.js";

const creator = (id, day = "2026-09-16") => ({ id, handle: "mesmo_handle", kol_calculado_em: day });
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const base = { requestUrl: "https://kollect.test/api/cron/collect", deadline: 100, now: () => 0 };

test("tags: retoma cálculos de squads após snapshot salvo, sem repetir coleta paga", () => {
  const creators = [creator("novo"), creator("pendente"), creator("atual", "2026-09-17"), creator("fora"),
    creator("sem_snapshot", null), creator("mesmo_dia")];
  const members = [{ creator_id: "novo" }, { creator_id: "pendente" }, { creator_id: "atual" },
    { creator_id: "sem_snapshot" }, { creator_id: "pendente" }, { creator_id: "mesmo_dia" }, { prospect_id: "externo" }];
  const snapshots = [{ creator_id: "pendente", captured_at: "2026-09-17" },
    { creator_id: "atual", captured_at: "2026-09-16" }, { creator_id: "fora", captured_at: "2026-09-17" },
    { creator_id: "mesmo_dia", captured_at: "2026-09-16" }];
  assert.deepEqual(squadScoreTargets(creators, members, snapshots, [creator("novo"), creator("fora")])
    .map((row) => row.id), ["novo", "pendente", "mesmo_dia"]);
});

test("recálculo: IDs distinguem handles iguais, squads têm prioridade e KOL vem após score", async () => {
  const calls = [];
  const report = await refreshCollectionScores({ ...base,
    collected: [creator("fora"), creator("instagram")], squadTargets: [creator("tiktok"), creator("instagram")],
    fetchImpl: async (url, options) => {
      const id = url.searchParams.get("id");
      calls.push({ id, path: url.pathname, ...options });
      return reply(url.pathname === "/api/score" ? { creator_id: id, total: 60 } : { gravado: true });
    },
  });
  assert.equal(report.rescorados, 3);
  assert.equal(report.tags_atualizadas, 2);
  assert.equal(report.rescore_pendentes, 0);
  assert.equal(report.tags_pendentes, 0);
  assert.equal(calls[0].id, "tiktok");
  for (const id of ["tiktok", "instagram"]) {
    assert.deepEqual(calls.filter((call) => call.id === id).map((call) => call.path), ["/api/score", "/api/kol-score"]);
  }
  assert.equal(calls.filter((call) => call.id === "fora").length, 1);
  assert.ok(calls.every((call) => call.cache === "no-store" && call.signal instanceof AbortSignal));
});

test("recálculo: 401 e erro de negócio em HTTP 200 não são contabilizados como sucesso", async () => {
  for (const response of [reply({ creator_id: "a" }, 401), reply({ creator_id: "a", err: "falhou" }),
    reply({ fatal: "falhou" }), reply({ error: "falhou" }), reply({ creator_id: "outra_conta" }), reply(null)]) {
    let calls = 0;
    const report = await refreshCollectionScores({ ...base, collected: [creator("a")], squadTargets: [creator("a")],
      fetchImpl: async () => { calls++; return response; },
    });
    assert.equal(report.rescorados, 0);
    assert.equal(report.rescore_falhas, 1);
    assert.equal(report.tags_atualizadas, 0);
    assert.equal(report.tags_pendentes, 1);
    assert.equal(calls, 1);
  }
});

test("recálculo: KOL exige confirmação de gravação, não só resposta HTTP aceita", async () => {
  for (const body of [{ gravado: false }, { fatal: "erro" }, { gravado: true, incompleto: true }, {}]) {
    const report = await refreshCollectionScores({ ...base, collected: [creator("a")], squadTargets: [creator("a")],
      fetchImpl: async (url) => reply(url.pathname === "/api/score" ? { creator_id: "a" } : body),
    });
    assert.equal(report.rescorados, 1);
    assert.equal(report.tags_atualizadas, 0);
    assert.equal(report.tags_falhas, 1);
    assert.equal(report.erros_scores[0].etapa, "kol-score");
  }
});

test("recálculo: respeita prazo entre score e KOL e informa o que falta", async () => {
  let current = 0;
  let calls = 0;
  const report = await refreshCollectionScores({ ...base, now: () => current,
    collected: [], squadTargets: [creator("a")],
    fetchImpl: async () => { calls++; current = 100; return reply({ creator_id: "a" }); },
  });
  assert.equal(calls, 1);
  assert.equal(report.rescorados, 1);
  assert.equal(report.tags_pendentes, 1);
  const expired = await refreshCollectionScores({ ...base, deadline: 0, collected: [creator("a")], squadTargets: [],
    fetchImpl: async () => { throw new Error("Não deveria chamar uma API"); },
  });
  assert.equal(expired.rescore_pendentes, 1);
  assert.equal(expired.rescorados, 0);
});

test("recálculo: limite de concorrência e falha de rede isolada por creator", async () => {
  let active = 0, peak = 0;
  const report = await refreshCollectionScores({ ...base, collected: Array.from({ length: 9 }, (_, id) => creator(String(id))),
    squadTargets: [], fetchImpl: async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      if (url.searchParams.get("id") === "0") throw new Error("rede");
      return reply({ creator_id: url.searchParams.get("id") });
    },
  });
  assert.equal(peak, 4);
  assert.equal(report.rescorados, 8);
  assert.equal(report.rescore_falhas, 1);
  assert.equal(report.rescore_pendentes, 0);
});
