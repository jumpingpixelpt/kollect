import { test } from "node:test";
import assert from "node:assert/strict";
import { handleDoLink, resolverReferencia, keywordsDaReferencia, partilhaSubNicho } from "../lib/referencia.js";

test("handleDoLink: instagram, tiktok, @handle e lixo", () => {
  assert.equal(handleDoLink("https://www.instagram.com/alan_vivian/"), "alan_vivian");
  assert.equal(handleDoLink("https://www.tiktok.com/@cabeleireirocalvo?lang=pt"), "cabeleireirocalvo");
  assert.equal(handleDoLink("instagram.com/Rodrigs.Ana"), "rodrigs.ana");
  assert.equal(handleDoLink("@biaz.f"), "biaz.f");
  assert.equal(handleDoLink("https://www.instagram.com/p/DbZKxo3uajQ/"), null);
  assert.equal(handleDoLink(""), null);
  assert.equal(handleDoLink("um texto qualquer com espaços"), null);
});

const base = [
  { id: "1", handle: "alan_vivian", platform: "instagram", followers: 1700000, brand_history: { nichos: [{ nicho: "Cabelo", pct: 80 }, { nicho: "Skincare", pct: 20 }], sub_nichos: ["Cacheado e crespo (método curly, transição)", { nome: "Coloração" }] } },
  { id: "2", handle: "outra", platform: "tiktok", followers: 1000, brand_history: { nichos: [], sub_nichos: [] } },
];

test("resolverReferencia: na base e fora da base", () => {
  const r = resolverReferencia("https://www.instagram.com/alan_vivian/", base);
  assert.equal(r.encontrado, true);
  assert.equal(r.id, "1");
  assert.equal(r.nicho, "cabelo");
  assert.deepEqual(r.sub_nichos, ["cacheado e crespo (metodo curly, transicao)", "coloracao"]);
  assert.deepEqual(keywordsDaReferencia(r), ["cabelo", "cacheado e crespo (metodo curly, transicao)", "coloracao"]);
  const f = resolverReferencia("https://www.tiktok.com/@ninguem", base);
  assert.deepEqual(f, { encontrado: false, handle: "ninguem" });
  assert.equal(resolverReferencia("", base), null);
  assert.deepEqual(keywordsDaReferencia(f), []);
});

test("partilhaSubNicho: compara sub-nichos normalizados", () => {
  const ref = resolverReferencia("@alan_vivian", base);
  assert.equal(partilhaSubNicho({ sub_nichos: ["Coloração"] }, ref), true);
  assert.equal(partilhaSubNicho({ sub_nichos: ["Penteados"] }, ref), false);
  assert.equal(partilhaSubNicho({ sub_nichos: ["Coloração"] }, { encontrado: false }), false);
});
