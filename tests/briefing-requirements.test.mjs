import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarRequisitos } from "../lib/briefing-requirements.js";

const creator = { id: "a", handle: "ana", platform: "instagram", followers: 12000,
  brand_history: { nichos: [{ nicho: "Cabelo", pct: 70 }] } };
const briefing = { plataforma: "instagram", faixa_min: 10000, faixa_max: 20000, territorio: "Cabelo" };

test("requisitos: 100 exige todos confirmados, sem usar posição ou score interno", () => {
  const a = avaliarRequisitos(briefing, { ...creator, total: 1, kol_score: { geral: { score: 2 } }, match_score: 3 });
  assert.equal(a.score, 100);
  assert.equal(a.atingidos, 3);
  assert.equal(a.total, 3);
  assert.equal(a.pendentes, 0);
  assert.equal(avaliarRequisitos(briefing, { ...creator, followers: 5000 }).score, 66.67);
  assert.equal(avaliarRequisitos({}, creator).score, null);
});

test("requisitos: dado ausente fica pendente e mantém denominador", () => {
  const a = avaliarRequisitos(briefing, { ...creator, followers: null });
  assert.equal(a.total, 3);
  assert.equal(a.atingidos, 2);
  assert.equal(a.pendentes, 1);
  assert.equal(a.requisitos.find((r) => r.id === "faixa-instagram").status, "pendente");
  const b = avaliarRequisitos(briefing, { ...creator, followers: 0 });
  assert.equal(b.requisitos.find((r) => r.id === "faixa-instagram").status, "nao_atingido");
});

test("requisitos: ambas exige as duas redes e não soma seguidores", () => {
  const parsed = { plataforma: "ambas", faixa_min: 20000, faixa_max: 50000 };
  const a = avaliarRequisitos(parsed, creator, { contas: [{ id: "b", handle: "ana.tt", platform: "tiktok", followers: 15000 }] });
  assert.equal(a.atingidos, 2);
  assert.equal(a.total, 4);
  assert.equal(a.score, 50);
  const semIrma = avaliarRequisitos({ plataforma: "ambas" }, creator);
  assert.equal(semIrma.score, 50);
  assert.equal(semIrma.requisitos.find((r) => r.id === "plataforma-tiktok").status, "nao_atingido");
});

test("requisitos: limites inclusivos, inválidos pendentes e zeros legados sem restrição", () => {
  for (const followers of [10000, 20000]) assert.equal(avaliarRequisitos(briefing, { ...creator, followers }).score, 100);
  assert.equal(avaliarRequisitos({ faixa_min: 0, faixa_max: 0 }, creator).total, 0);
  for (const faixa_min of ["abc", -5, 25000]) {
    const r = avaliarRequisitos({ faixa_min, faixa_max: 20000 }, creator);
    assert.equal(r.pendentes, 1);
    assert.equal(r.score, 0);
  }
});

test("requisitos: território confirmado prevalece, ausência de evidência não confirma", () => {
  const p = { territorio: "Pele", campos: { tema_territorio: { claro: true, valor: "Cabelo" } } };
  assert.equal(avaliarRequisitos(p, creator).score, 100);
  assert.equal(avaliarRequisitos({ territorio: "Pele" }, creator).pendentes, 1);
  assert.equal(avaliarRequisitos({ territorio: "Cabelo" }, { brand_history: { nichos: [{ nicho: "Cabelo", pct: 0 }] } }).requisitos[0].status, "nao_atingido");
  assert.equal(avaliarRequisitos({ territorio: "Cabelo" }, { kol_screen: { metricas: { niche_bucket: "cabelo" } }, brand_history: { nichos: [{ nicho: "Cabelo", pct: 0 }] } }).requisitos[0].status, "nao_atingido");
});

test("requisitos: texto editorial e público sem limiar não inventam confirmação", () => {
  const a = avaliarRequisitos({ publico_alvo: "feminino", perfil: "autoridade capilar", negativos: ["apostas"] }, { ...creator, audience: { mulheres_pct: 80 } });
  assert.equal(a.total, 3);
  assert.equal(a.pendentes, 3);
  assert.equal(a.score, 0);
  assert.equal(avaliarRequisitos({ negativos: ["cabelo"] }, creator).requisitos[0].status, "nao_atingido");
  assert.equal(avaliarRequisitos({ marca_alvo: "Marca", objetivo: "Venda", keywords: ["cabelo"], referencia: "@modelo" }, creator).total, 0);
});
