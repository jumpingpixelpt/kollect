import { test } from "node:test";
import assert from "node:assert/strict";
import { classificar, volumeConversa, conteudoConversa, leituraConversa, bandaDe } from "../lib/conversa.js";

test("classificar: perguntas, pedidos e reações", () => {
  assert.equal(classificar("Qual é esse aplicativo que você usa ?"), "pergunta");
  assert.equal(classificar("onde comprar! por favor me fala"), "pedido");
  assert.equal(classificar("indica um shampoo pra cabelo oleoso"), "pedido");
  assert.equal(classificar("BIO OIL NO OLHO???"), "pergunta");
  assert.equal(classificar("amei o vídeo"), null);
  // "quando chego cedo fico no carro" começava por "quando" e contava como pergunta (piloto 11/09)
  assert.equal(classificar("quando chego mt antes, eu fico esperando no meu carro kkk"), null);
  assert.equal(classificar(""), null);
});

test("bandaDe: faixas de seguidores", () => {
  assert.equal(bandaDe(9000), "<50k");
  assert.equal(bandaDe(50000), "50-100k");
  assert.equal(bandaDe(161500), "100-500k");
  assert.equal(bandaDe(1740148), "500k+");
});

test("volumeConversa: média, faixa, consistência e imagens de fora", () => {
  const videos = [
    { comments: 100, tipo: "video" }, { comments: 120, tipo: "video" }, { comments: 80, tipo: "video" },
    { comments: 5000, tipo: "imagem" }, // não conta: só vídeo
    { comments: null, tipo: "video" },  // sem medida
  ];
  const v = volumeConversa(videos, 100000, { mediana_comentarios: 50, n: 200 });
  assert.equal(v.pecas, 3);
  assert.equal(v.media_comentarios, 100);
  assert.equal(v.mediana_comentarios, 100);
  assert.equal(v.por_1k_seguidores, 1);
  assert.equal(v.faixa, "100-500k");
  assert.equal(v.indice_faixa, 2);
  assert.equal(v.mediana_faixa, 50);
  assert.ok(v.consistencia > 70 && v.consistencia <= 100, `consistência ${v.consistencia}`);
  assert.equal(volumeConversa([], 1000, null), null);
  // sem benchmark não há índice, e não rebenta
  assert.equal(volumeConversa(videos, 100000, null).indice_faixa, null);
});

test("conteudoConversa: TikTok com relação pai→filho", () => {
  const c = [
    { id: "1", texto: "Qual shampoo você usa?", autor: "fa1", resposta_de: null },
    { id: "2", texto: "amei", autor: "fa2", resposta_de: null },
    { id: "3", texto: "onde compra?", autor: "fa3", resposta_de: null },
    { id: "4", texto: "Uso o da Elseve!", autor: "creator", resposta_de: "1" },
    { id: "5", texto: "eu também quero saber", autor: "fa4", resposta_de: "3" },
  ];
  const r = conteudoConversa(c, "@Creator");
  assert.equal(r.comentarios_lidos, 3);
  assert.equal(r.respostas_lidas, 2);
  assert.equal(r.respostas_creator, 1);
  assert.equal(r.pct_duvidas, 67);
  assert.equal(r.taxa_resposta, 50); // 1 das 2 dúvidas respondida
  assert.equal(r.taxa_aproximada, false);
});

test("conteudoConversa: Instagram achatado — comentário da creator é resposta, taxa aproximada", () => {
  const c = [
    { id: "1", texto: "Onde comprar! Por favor me fala", autor: "fa1", resposta_de: null },
    { id: "2", texto: "Olha lá no seu direct. Mandei o link 😊", autor: "rodrigs.ana", resposta_de: null },
    { id: "3", texto: "Olha lá no seu direct. Mandei o link 😊", autor: "rodrigs.ana", resposta_de: null },
    { id: "4", texto: "linda", autor: "fa2", resposta_de: null },
  ];
  const r = conteudoConversa(c, "rodrigs.ana");
  assert.equal(r.comentarios_lidos, 2);        // os da creator saem do topo
  assert.equal(r.respostas_creator, 2);
  assert.equal(r.pct_duvidas, 50);
  assert.equal(r.taxa_aproximada, true);
  assert.equal(r.taxa_resposta, 100);          // 2 respostas para 1 dúvida → tecto 100
});

test("conteudoConversa: exemplos sem @menções e sem repetidos", () => {
  const c = [
    { id: "1", texto: "@bethsousad o que achou a longo prazo??", autor: "a", resposta_de: null },
    { id: "2", texto: "@bethsousad o que achou a longo prazo??", autor: "b", resposta_de: null },
    { id: "3", texto: "x".repeat(200) + "?", autor: "c", resposta_de: null },
  ];
  const r = conteudoConversa(c, "creator");
  assert.deepEqual(r.exemplos, ["@… o que achou a longo prazo??"]);
});

test("leituraConversa: frases nos moldes do cliente", () => {
  const vol = { media_comentarios: 117, mediana_faixa: 141, faixa: "100-500k", indice_faixa: 0.83, consistencia: 0 };
  const t = leituraConversa(vol, { pct_duvidas: 30, taxa_resposta: 100 });
  assert.match(t, /na média dos perfis do mesmo tamanho/);
  assert.match(t, /concentra-se em poucas peças/);
  assert.match(t, /parcela relevante das interações \(30%\)/);
  assert.match(t, /responde a 100%/);
  assert.match(leituraConversa({ ...vol, indice_faixa: 3 }, null), /considerada alta/);
  assert.equal(leituraConversa(null, null), null);
});
