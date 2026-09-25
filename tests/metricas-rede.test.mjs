import test from "node:test";
import assert from "node:assert/strict";
import { calcularMetricasRede } from "../lib/metricas-rede.js";
import { redeMaisForte, objetivoDe } from "../lib/rede-forte.js";

const hoje = new Date("2026-09-21T12:00:00Z");
const peca = (creator_id, dia, views, likes, comments, title = "") => ({ creator_id, posted_at: `2026-09-${String(dia).padStart(2, "0")}`, views, likes, comments, shares: 0, saves: 0, title });

test("metricas_rede separa por rede, publi e total; ER só sobre peças com views", () => {
  const contas = [{ id: "ig", handle: "ana", platform: "instagram", followers: 100000 }, { id: "tk", handle: "ana.tk", platform: "tiktok", followers: 20000 }];
  const videos = [
    peca("ig", 1, 10000, 900, 100), peca("ig", 2, 10000, 900, 100, "#publi da marca"), peca("ig", 3, null, 5000, 50),
    peca("tk", 1, 40000, 1000, 20), peca("tk", 2, 40000, 1000, 20), peca("tk", 3, 40000, 1000, 20),
  ];
  const m = calcularMetricasRede(contas, videos, { hoje });
  assert.equal(m.redes.instagram.n_pecas, 3);
  assert.equal(m.redes.instagram.views_media, 10000); // a foto sem views não entra na média
  assert.equal(m.redes.instagram.eng_rate, 10); // (1000+1000) ÷ 20000, sem os likes da foto
  assert.equal(m.redes.tiktok.eng_rate, 2.55);
  assert.equal(m.publi.n_pecas, 1);
  assert.equal(m.organico.n_pecas, 5);
  assert.equal(m.total.seguidores, 120000);
  assert.equal(m.total.n_pecas, 6);
});

test("sem peças, null; uma rede só não dá rede mais forte", () => {
  assert.equal(calcularMetricasRede([{ id: "x", platform: "tiktok" }], [], { hoje }), null);
  const m = calcularMetricasRede([{ id: "tk", platform: "tiktok", followers: 10 }], [peca("tk", 1, 10, 1, 1), peca("tk", 2, 10, 1, 1), peca("tk", 3, 10, 1, 1)], { hoje });
  assert.deepEqual(redeMaisForte(m), []);
});

test("rede mais forte: awareness por views/seguidor, engajamento por ER; objetivo ordena", () => {
  const m = { redes: {
    instagram: { n_pecas: 10, views_media: 10000, seguidores: 100000, eng_rate: 8, comentarios_media: 90 },
    tiktok: { n_pecas: 10, views_media: 40000, seguidores: 20000, eng_rate: 3, comentarios_media: 20 },
  } };
  const aw = redeMaisForte(m, { objetivo: "awareness", indiceFaixa: 0.4 });
  assert.equal(aw[0].objetivo, "awareness");
  assert.equal(aw[0].rede, "tiktok");
  assert.match(aw[0].frase, /Forte em views no TikTok .* mas comentários abaixo da faixa \(0,4×\)/);
  assert.equal(aw[1].rede, "instagram");
  const en = redeMaisForte(m, { objetivo: "venda", engIndex: 1.5 });
  assert.equal(en[0].objetivo, "engajamento");
  assert.match(en[0].frase, /e engajamento acima dos pares \(1,5×\)/);
});

test("objetivo do briefing: rótulo fechado ou texto livre", () => {
  assert.equal(objetivoDe({ objetivo: "Engajamento" }), "engajamento");
  assert.equal(objetivoDe({ objetivo: "Relançamento e educação de mercado; meta secundária de conversão" }), "awareness");
  assert.equal(objetivoDe({ objetivo: "" }), null);
});
