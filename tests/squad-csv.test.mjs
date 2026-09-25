import { test } from "node:test";
import assert from "node:assert/strict";
import { csvPtBr, linhasCsvSquad, COLUNAS_SQUAD, nomeArquivo } from "../lib/squad-csv.js";

test("CSV do squad usa ; + BOM, E.R. = eng ÷ views e dado ausente vazio", () => {
  const items = [
    { id: "a", creator_id: "c1", creator: { name: "Ana; \"Cachos\"", handle: "ana", platform: "instagram", followers: 12000 },
      metrics: { avg_views: 1000, eng_rate: 5.5 }, media_comentarios: 12.4, curadoria: "em_estudo", notas: "linha 1\nlinha 2", territorio: "Cabelo 80%", tag: "kol", perfil_url: "https://www.instagram.com/ana/" },
    { id: "b", creator_id: null, prospect: { name: "Externo", handle: "ext", platform: "tiktok", followers: null }, metrics: null, curadoria: "sugerida", tag: null },
  ];
  const linhas = linhasCsvSquad(items);
  assert.deepEqual(linhas[0], COLUNAS_SQUAD);
  assert.deepEqual(linhas[1].slice(4, 13), ["12000", "1000", "12", "55", "5,5", "Em estudo", "linha 1\nlinha 2", "Cabelo 80%", "KOL"]);
  assert.deepEqual(linhas[2].slice(4, 9), ["", "", "", "", ""]);
  assert.equal(linhas[2][12], "A analisar");
  const csv = csvPtBr(linhas);
  assert.ok(csv.startsWith("﻿\"Creator\";\"@\";"));
  assert.ok(csv.includes('"Ana; ""Cachos"""'));
  assert.equal(nomeArquivo("Squad Ação!", "csv"), "squad-squad-acao.csv");
});
