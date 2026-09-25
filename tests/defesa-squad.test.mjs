import { test } from "node:test";
import assert from "node:assert/strict";
import { defesaModelo, membrosDaDefesa, promptDefesa, limparPorque } from "../lib/defesa-squad.js";

const membro = (o) => ({ nome: "X", handle: "@x", rede: "Instagram", tag: "KOL", curadoria: "sugerida", seguidores: null, views_media: null, eng_rate: null, comentarios_media: null, territorio: null, redes: [], rede_forte: null, porque: null, notas: null, em_analise: false, ...o });

test("defesa-modelo: aprovados primeiro, descartados fora, notas e lacunas", () => {
  const ctx = {
    squad: "Cachos",
    briefing: { nome: "Briefing A", objetivo: "Awareness", territorio: "cabelo cacheado.", keywords: ["cachos"], marca: "Elsève", produto: null, publico: "feminino", texto: "..." },
    projecao: { views: 100000, eng: 5000, er: 5, erBase: 2, total: 4, alcance: 300000, alcanceBase: 4, base: 2 },
    membros: [
      membro({ nome: "Sugerida S", seguidores: 900000 }),
      membro({ nome: "Aprovada A", curadoria: "aprovada", seguidores: 1000, views_media: 5000, eng_rate: 4.2, notas: "Já trabalhou com a marca" }),
      membro({ nome: "Descartada D", curadoria: "descartada" }),
      membro({ nome: "Externa E", em_analise: true, rede: "TikTok" }),
    ],
  };
  assert.deepEqual(membrosDaDefesa(ctx.membros).map((m) => m.nome), ["Aprovada A", "Sugerida S", "Externa E"]);
  const t = defesaModelo(ctx);
  for (const s of ["DEFESA DO SQUAD — Cachos", "OBJETIVO DO BRIEFING", "POR QUE ESTE CONJUNTO", "OS CREATORS", "RISCOS E LACUNAS DE DADOS", "Nota da equipa: “Já trabalhou com a marca”", "E.R. 4,2%", "1 descartado fica fora", "ainda em análise"]) assert.ok(t.includes(s), s);
  assert.ok(t.indexOf("Aprovada A") < t.indexOf("Sugerida S"));
  assert.equal(t.includes("Descartada D"), false);
  assert.equal(t.includes("cacheado.."), false);
  assert.ok(promptDefesa(ctx).includes("Aprovada A"));
});

test("limparPorque tira as réguas internas do casting antigo", () => {
  assert.equal(limparPorque("Rising Bet — conteúdo de cachos · aderência ao brief 65"), "Conteúdo de cachos");
  assert.equal(limparPorque(""), null);
});
