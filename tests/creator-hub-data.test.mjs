import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCreatorHubInsights } from "../lib/creator-hub-data.js";

const hoje = new Date("2026-09-18T01:30:00+03:00");
const conta = (id, platform = "instagram", extra = {}) => ({
  id, name: `Perfil ${id}`, handle: id, platform, avatar_url: null, person_key: "pessoa", ...extra,
});
const peca = (id, creator_id = "principal", extra = {}) => ({
  id, creator_id, posted_at: "2026-09-17", url: `https://exemplo.test/peca/${id}`,
  title: "Rotina capilar", views: 100, comments: 2, ...extra,
});

// Simula projeção, filtros e o limite real de uma resposta do Supabase.
// O registro das consultas permite conferir a janela aplicada no servidor.
function banco(tabelas, { falha = () => false } = {}) {
  const consultas = [];
  return {
    consultas,
    from(tabela) {
      const q = { tabela, filtros: [], ordem: [], de: 0, ate: 999, campos: "*", unica: false };
      const executar = () => {
        consultas.push({ ...q, filtros: [...q.filtros] });
        if (falha(q)) return { data: null, error: { message: "leitura interrompida" } };
        let rows = [...(tabelas[tabela] || [])].filter((row) => q.filtros.every(([op, campo, valor]) => {
          if (op === "eq") return row[campo] === valor;
          if (op === "in") return valor.includes(row[campo]);
          const atual = campo === "posted_at" ? Date.parse(row[campo]) : row[campo];
          const limite = campo === "posted_at" ? Date.parse(valor) : valor;
          return op === "gte" ? atual >= limite : atual < limite;
        }));
        rows.sort((a, b) => {
          for (const [campo, asc] of q.ordem) {
            const cmp = a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0;
            if (cmp) return asc ? cmp : -cmp;
          }
          return 0;
        });
        rows = rows.slice(q.de, q.ate + 1).map((row) => q.campos === "*" ? { ...row }
          : Object.fromEntries(q.campos.split(",").map((campo) => [campo.trim(), row[campo.trim()] ?? null])));
        return { data: q.unica ? rows[0] ?? null : rows, error: null };
      };
      const api = {
        select(campos) { q.campos = campos; return api; },
        eq(campo, valor) { q.filtros.push(["eq", campo, valor]); return api; },
        in(campo, valor) { q.filtros.push(["in", campo, valor]); return api; },
        gte(campo, valor) { q.filtros.push(["gte", campo, valor]); return api; },
        lt(campo, valor) { q.filtros.push(["lt", campo, valor]); return api; },
        order(campo, { ascending = true } = {}) { q.ordem.push([campo, ascending]); return api; },
        range(de, ate) { q.de = de; q.ate = ate; return api; },
        maybeSingle() { q.unica = true; return api; },
        throwOnError() { q.lanca = true; return api; },
        then(ok, erro) {
          return Promise.resolve().then(() => {
            const result = executar();
            if (q.lanca && result.error) throw new Error(result.error.message);
            return result;
          }).then(ok, erro);
        },
      };
      return api;
    },
  };
}

test("Hub: reúne somente contas vinculadas e inclui a conta ativa uma única vez", async () => {
  const db = banco({
    leaderboard: [conta("principal"), conta("irma", "tiktok"), conta("outra", "youtube", { person_key: "outra-pessoa" })],
    videos: [peca("ig"), peca("tk", "irma"), peca("fora", "outra")],
  });
  const result = await fetchCreatorHubInsights(db, "principal", { hoje });
  assert.equal(result.creator.id, "principal");
  assert.deepEqual(result.creator.accounts.map((account) => account.id), ["principal", "irma"]);
  assert.deepEqual(result.videos.map((video) => video.id), ["ig", "tk"]);
  assert.ok(db.consultas.some((q) => q.tabela === "leaderboard" && q.filtros.some(([op, campo, valor]) => op === "eq" && campo === "person_key" && valor === "pessoa")));
});

test("Hub: sem vínculo manual consulta somente a própria conta", async () => {
  const db = banco({
    leaderboard: [conta("principal", "instagram", { person_key: null }), conta("outra", "instagram", { person_key: null })],
    videos: [peca("propria"), peca("fora", "outra")],
  });
  const result = await fetchCreatorHubInsights(db, "principal", { hoje });
  assert.deepEqual(result.creator.accounts.map((account) => account.id), ["principal"]);
  assert.deepEqual(result.videos.map((video) => video.id), ["propria"]);
  assert.equal(db.consultas.filter((q) => q.tabela === "leaderboard").length, 1);
});

test("Hub: carrega mais de mil peças e inclui a última página nos indicadores", async () => {
  const videos = Array.from({ length: 1002 }, (_, i) => peca(`peca-${String(i).padStart(4, "0")}`, "principal", { comments: i === 1001 ? 20 : 0 }));
  const db = banco({ leaderboard: [conta("principal")], videos });
  const result = await fetchCreatorHubInsights(db, "principal", { hoje });
  assert.equal(result.videos.length, 1002);
  assert.equal(result.coverage.total, 1002);
  assert.equal(result.metrics.comments.sum, 20);
  assert.equal(result.metrics.comments.measured, 1002);
  assert.ok(result.videos.some((video) => video.id === "peca-1001"));
  assert.deepEqual(db.consultas.filter((q) => q.tabela === "videos").map((q) => [q.de, q.ate]), [[0, 999], [1000, 1999]]);
});

test("Hub: restringe a consulta aos 90 dias UTC, do início inclusivo ao dia seguinte exclusivo", async () => {
  const db = banco({
    leaderboard: [conta("principal")],
    videos: [
      peca("inicio", "principal", { posted_at: "2026-06-20T00:00:00Z" }),
      peca("fim", "principal", { posted_at: "2026-09-17T23:59:59.999Z" }),
      peca("antes", "principal", { posted_at: "2026-06-19T23:59:59.999Z" }),
      peca("depois", "principal", { posted_at: "2026-09-18T00:00:00Z" }),
    ],
  });
  const result = await fetchCreatorHubInsights(db, "principal", { hoje });
  assert.deepEqual(result.window, { start: "2026-06-20", end: "2026-09-17", days: 90 });
  assert.deepEqual(result.videos.map((video) => video.id), ["fim", "inicio"]);
  const query = db.consultas.find((q) => q.tabela === "videos");
  assert.ok(query.filtros.some(([op, campo, valor]) => op === "gte" && campo === "posted_at" && valor === "2026-06-20"));
  assert.ok(query.filtros.some(([op, campo, valor]) => op === "lt" && campo === "posted_at" && valor === "2026-09-18"));
});

test("Hub: devolve rede da conta e remove transcrição, análises, scores e vínculo privado", async () => {
  const db = banco({
    leaderboard: [conta("principal", "instagram", { score: 99, kol_score: { privado: "reservado" } }), conta("irma", "tiktok")],
    videos: [
      peca("ig", "principal", { platform: "youtube", transcript: "Parceria #publi", analysis: { privado: "reservado" }, content_score: 99, person_key: "reservado" }),
      peca("tk", "irma", { platform: "instagram" }),
    ],
  });
  const result = await fetchCreatorHubInsights(db, "principal", { hoje });
  assert.equal(result.videos.find((video) => video.id === "ig").platform, "instagram");
  assert.equal(result.videos.find((video) => video.id === "tk").platform, "tiktok");
  assert.equal(result.videos.find((video) => video.id === "ig").publi, true);
  const proibidos = new Set(["transcript", "analysis", "score", "content_score", "kol_score", "person_key"]);
  const conferir = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(proibidos.has(key), false, `Campo privado na resposta: ${key}`);
      conferir(child);
    }
  };
  conferir(result);
  assert.equal(JSON.stringify(result).includes("reservado"), false);
});

test("Hub: perfil inexistente devolve null sem consultar peças ou contas vinculadas", async () => {
  const db = banco({ leaderboard: [], videos: [peca("orfao")] });
  assert.equal(await fetchCreatorHubInsights(db, "ausente", { hoje }), null);
  assert.equal(db.consultas.length, 1);
  assert.equal(db.consultas[0].tabela, "leaderboard");
});

test("Hub: erro na segunda página de peças rejeita sem apresentar totais parciais", async () => {
  const db = banco({
    leaderboard: [conta("principal")],
    videos: Array.from({ length: 1001 }, (_, i) => peca(i)),
  }, { falha: (q) => q.tabela === "videos" && q.de === 1000 });
  await assert.rejects(fetchCreatorHubInsights(db, "principal", { hoje }), /Não foi possível carregar todos os registros/);
});

test("Hub: erro na segunda página de contas vinculadas também rejeita a leitura", async () => {
  const db = banco({
    leaderboard: [conta("principal"), ...Array.from({ length: 1001 }, (_, i) => conta(`irma-${i}`))],
  }, { falha: (q) => q.tabela === "leaderboard" && q.de === 1000 });
  await assert.rejects(fetchCreatorHubInsights(db, "principal", { hoje }), /Não foi possível carregar todos os registros/);
  assert.equal(db.consultas.some((q) => q.tabela === "videos"), false);
});
