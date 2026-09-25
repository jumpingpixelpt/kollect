import { test } from "node:test";
import assert from "node:assert/strict";
import { isSquadEmailConfigured, processSquadAlerts, sendSquadEmail, squadAlertMessage } from "../lib/squad-notifications.js";

const env = { SQUAD_ALERTS_ENABLED: "1", RESEND_API_KEY: "fake-key", SQUAD_EMAIL_FROM: "KOLLECT <alerts@example.test>" };
const alert = { id: "alert-1", claim_token: "claim-1", membership_id: "member-1", list_id: "list-1", creator_id: "creator-1", recipient_email: "owner@example.test", list_name: "Squad teste", creator_name: "Ana", creator_handle: "ana" };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, async json() { return data; } });

function database({ existingBody, member = true, lostClaim = false, finishError = false, memberError = false } = {}) {
  const calls = [];
  let claims = 0;
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "squad_collect_alerts") return { data: 1 };
      if (name === "squad_claim_alert") return { data: claims++ === 0 ? [{ ...alert, request_body: existingBody }] : [] };
      if (name === "squad_finish_alert") return finishError ? { error: { message: "db indisponível" } } : { data: true };
      throw new Error(name);
    },
    from(table) {
      const filters = {};
      let update;
      const query = {
        update(value) { update = value; return query; },
        eq(key, value) { filters[key] = value; return query; },
        select() { return query; },
        async maybeSingle() {
          calls.push({ table, filters });
          return memberError ? { error: { message: "leitura indisponível" } } : { data: member ? { id: alert.membership_id } : null };
        },
        then(resolve, reject) {
          calls.push({ table, filters, update });
          return Promise.resolve({ data: lostClaim ? [] : [{ id: alert.id }] }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("alertas exigem ativação, credenciais e ambiente fora de preview", async () => {
  assert.equal(isSquadEmailConfigured(env), true);
  for (const configuration of [{}, { ...env, VERCEL_ENV: "preview" }, { ...env, SQUAD_ALERTS_ENABLED: "0" }, { ...env, RESEND_API_KEY: " " }, { ...env, SQUAD_EMAIL_FROM: "" }]) {
    assert.equal(isSquadEmailConfigured(configuration), false);
    const result = await processSquadAlerts({ rpc() { assert.fail("Não deve ler a fila"); } }, { env: configuration });
    assert.equal(result.ok, true);
    assert.ok(result.skipped);
  }
});

test("mensagem vai só ao criador do squad, escapa HTML e usa link HTTPS", () => {
  const message = squadAlertMessage({ ...alert, list_name: '<img src=x onerror="alert(1)">\nTeste', creator_handle: '@a&"b' }, env);
  assert.deepEqual(message.to, ["owner@example.test"]);
  assert.match(message.html, /@a&amp;&quot;b/);
  assert.equal(message.html.includes("<img"), false);
  assert.equal(message.subject.includes("\n"), false);
  assert.match(message.text, /https:\/\/www\.kollect\.online\/listas\?id=list-1/);
  assert.throws(() => squadAlertMessage(alert, { ...env, SQUAD_APP_URL: "http://example.test" }), /HTTPS/);
});

test("envio usa chave estável e distingue conflito concorrente de payload inválido", async () => {
  const message = squadAlertMessage(alert, env);
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, options }); return response(200, { id: "provider-1" }); };
  assert.equal(await sendSquadEmail(alert, message, { env, fetchImpl }), "provider-1");
  assert.equal(await sendSquadEmail(alert, message, { env, fetchImpl }), "provider-1");
  assert.deepEqual(requests[0].options.headers, requests[1].options.headers);
  assert.equal(requests[0].options.headers["Idempotency-Key"], "squad-rising/alert-1");
  assert.equal(requests[0].options.body, JSON.stringify(message));
  for (const [status, data, retryable] of [[409, { name: "concurrent_idempotent_requests" }, true], [409, { name: "invalid_idempotent_request" }, false], [429, {}, true], [503, {}, true], [401, {}, false], [422, {}, false], [200, {}, true]]) {
    await assert.rejects(sendSquadEmail(alert, message, { env, fetchImpl: async () => response(status, data) }), (error) => error.retryable === retryable);
  }
  await assert.rejects(sendSquadEmail(alert, message, { env, fetchImpl: async () => { throw new Error("timeout"); } }), (error) => error.retryable === true);
});

test("corpo é persistido sob token antes de enviar e concluir a entrega", async () => {
  const db = database();
  const result = await processSquadAlerts(db, { env, fetchImpl: async () => {
    const prepared = db.calls.find((call) => call.table === "squad_alerts");
    assert.deepEqual(prepared.filters, { id: "alert-1", claim_token: "claim-1", status: "processing" });
    assert.deepEqual(prepared.update.request_body.to, ["owner@example.test"]);
    const checked = db.calls.find((call) => call.table === "list_creators");
    assert.deepEqual(checked.filters, { id: "member-1", creator_id: "creator-1", list_id: "list-1" });
    return response(200, { id: "provider-1" });
  } });
  assert.deepEqual(result, { ok: true, queued: 1, sent: 1, failed: 0 });
  assert.deepEqual(db.calls.find((call) => call.name === "squad_finish_alert").args, { p_id: "alert-1", p_token: "claim-1", p_status: "sent", p_error: null, p_provider_id: "provider-1" });
});

test("retry reutiliza corpo original mesmo após alterar remetente ou nome", async () => {
  const original = squadAlertMessage(alert, env);
  const db = database({ existingBody: original });
  await processSquadAlerts(db, { env: { ...env, SQUAD_EMAIL_FROM: "outro@example.test" }, fetchImpl: async (_, options) => {
    assert.deepEqual(JSON.parse(options.body), original);
    return response(200, { id: "provider-1" });
  } });
  assert.equal(db.calls.some((call) => call.update), false);
});

test("membro removido ou reserva perdida impedem envio", async () => {
  for (const settings of [{ member: false }, { member: false, existingBody: squadAlertMessage(alert, env) }, { lostClaim: true }]) {
    const db = database(settings);
    const result = await processSquadAlerts(db, { env, fetchImpl: async () => assert.fail("Não deve enviar") });
    assert.equal(result.sent, 0);
    assert.equal(db.calls.some((call) => call.name === "squad_finish_alert"), false);
  }
  await assert.rejects(processSquadAlerts(database({ memberError: true }), { env, fetchImpl: async () => assert.fail("Não deve enviar") }), /conferir o membro/);
});

test("falha transitória retorna à fila e rejeição definitiva termina o alerta", async () => {
  for (const [status, name, expected] of [[409, "concurrent_idempotent_requests", "pending"], [422, "validation_error", "failed"]]) {
    const db = database();
    const result = await processSquadAlerts(db, { env, fetchImpl: async () => response(status, { name }) });
    assert.equal(result.ok, false);
    assert.equal(result.failed, 1);
    assert.equal(db.calls.find((call) => call.name === "squad_finish_alert").args.p_status, expected);
  }
});

test("falha no banco após aceite não reclassifica entrega como falha de envio", async () => {
  const db = database({ finishError: true });
  let sent = 0;
  await assert.rejects(processSquadAlerts(db, { env, fetchImpl: async () => { sent++; return response(200, { id: "provider-1" }); } }), /squad_finish_alert/);
  assert.equal(sent, 1);
  const finishes = db.calls.filter((call) => call.name === "squad_finish_alert");
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].args.p_status, "sent");
});
