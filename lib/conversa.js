// CONVERSA COM A COMUNIDADE — a régua que substitui "autoridade social (proxy v1)" e
// "aderência de audiência" na ficha (feedback do cliente, set/2026, ponto 14).
//
// O que o cliente pediu que se medisse:
//   · média de comentários por publicação;
//   · volume de comentários em relação ao tamanho do perfil;
//   · comparação com creators da mesma faixa de seguidores;
//   · consistência desse volume entre conteúdos;
//   · percentual de comentários com perguntas, pedidos de recomendação ou dúvidas;
//   · frequência com que a creator responde.
//
// As quatro primeiras saem das peças já no banco (`videos.comments`) e da view
// `conversa_bench` (mediana da faixa). As duas últimas exigem o TEXTO dos comentários, que
// /api/conversa raspa no Apify para uma amostra de peças. Só os agregados ficam gravados
// (creators.conversa) — o texto dos comentários é de terceiros e não se guarda; ficam três
// exemplos curtos de perguntas, sem autor, como evidência.

// "?" é o sinal principal; sem ele, só interrogativas claras no início — "quando chego cedo
// fico no carro" começava por "quando" e contava como pergunta (piloto de 11/09).
const RX_PERGUNTA = /\?|^\s*(qual|quais|onde|como|quanto|quantos|alguém sabe|alguem sabe|me (diz|fala|explica)|será que|sera que)\b/i;
const RX_PEDIDO = /\b(indica|indicaç|recomend|dica|qual (o |a )?(produto|marca|shampoo|creme|sérum|serum|base|batom|perfume|óleo|oleo)|link|onde (compr|acho|encontr)|nome d[oa]|me (passa|manda|fala|diz)|manda o|qual (é|e) o|qual usa|o que (você|vc) usa|que produto|cupom|quanto cust)/i;

/** Classifica um comentário: pergunta/dúvida, pedido de recomendação, ou nenhum. */
export function classificar(texto) {
  const t = String(texto || "").trim();
  if (t.length < 2) return null;
  const pedido = RX_PEDIDO.test(t);
  const pergunta = RX_PERGUNTA.test(t);
  return pedido ? "pedido" : pergunta ? "pergunta" : null;
}

/** Mediana simples. */
const mediana = (arr) => { const a = arr.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export function bandaDe(followers) {
  const f = Number(followers) || 0;
  return f >= 500000 ? "500k+" : f >= 100000 ? "100-500k" : f >= 50000 ? "50-100k" : "<50k";
}

/**
 * Agregados de volume, a partir das peças do banco e da mediana da faixa.
 * @param videos linhas de `videos` (comments, tipo)
 * @param followers seguidores da conta
 * @param bench linha de conversa_bench da faixa ({ mediana_comentarios, mediana_por_1k, n })
 */
export function volumeConversa(videos, followers, bench) {
  const cs = (videos || []).filter((v) => v.comments != null && v.tipo !== "imagem").map((v) => Number(v.comments));
  if (!cs.length) return null;
  const media = cs.reduce((s, x) => s + x, 0) / cs.length;
  const med = mediana(cs);
  const desvio = Math.sqrt(cs.reduce((s, x) => s + (x - media) ** 2, 0) / cs.length);
  // consistência: 100 = todas as peças com o mesmo volume; 0 = uma peça viral e o resto mudo
  const consistencia = media > 0 ? Math.round(Math.max(0, 1 - desvio / media) * 100) : null;
  const por1k = followers > 0 ? media / (followers / 1000) : null;
  const indiceFaixa = bench?.mediana_comentarios > 0 ? media / Number(bench.mediana_comentarios) : null;
  return {
    pecas: cs.length,
    media_comentarios: Math.round(media),
    mediana_comentarios: med,
    por_1k_seguidores: r1(por1k),
    consistencia,
    faixa: bandaDe(followers),
    indice_faixa: indiceFaixa == null ? null : Math.round(indiceFaixa * 100) / 100,
    mediana_faixa: bench?.mediana_comentarios != null ? Math.round(Number(bench.mediana_comentarios)) : null,
    n_faixa: bench?.n ?? null,
  };
}

/**
 * Agregados de conteúdo dos comentários raspados.
 * @param comentarios [{ texto, autor, resposta_de, pecaUrl }] — `resposta_de` é o id do
 *   comentário-pai quando é uma resposta; `autor` é o handle de quem escreveu
 * @param handle handle da creator (para contar as respostas dela)
 */
export function conteudoConversa(comentarios, handle) {
  const h = String(handle || "").toLowerCase().replace(/^@/, "");
  // Comentário da própria creator é sempre resposta — no Instagram as respostas vêm
  // achatadas, sem id do pai, e "Olha lá no seu direct, mandei o link" contava como pedido
  // de recomendação da audiência (piloto de 11/09/2026).
  const ehCreator = (c) => String(c.autor || "").toLowerCase().replace(/^@/, "") === h;
  const topo = comentarios.filter((c) => !c.resposta_de && !ehCreator(c));
  const respostas = comentarios.filter((c) => c.resposta_de || ehCreator(c));
  const daCreator = respostas.filter(ehCreator);
  const respondidos = new Set(daCreator.map((c) => c.resposta_de).filter(Boolean));

  let perguntas = 0, pedidos = 0, perguntasRespondidas = 0;
  const exemplos = [];
  for (const c of topo) {
    const k = classificar(c.texto);
    if (!k) continue;
    if (k === "pedido") pedidos++; else perguntas++;
    if (respondidos.has(c.id)) perguntasRespondidas++;
    // sem @menções: os exemplos são evidência do tipo de dúvida, não de quem a fez
    const ex = c.texto.replace(/@[\w.]+/g, "@…").trim();
    if (exemplos.length < 3 && ex.length <= 140 && !exemplos.includes(ex)) exemplos.push(ex);
  }
  const duvidas = perguntas + pedidos;
  // taxa de resposta: com a relação pai→filho conhecida (TikTok) conta as dúvidas respondidas;
  // sem ela (Instagram) aproxima pelo número de respostas da creator sobre as dúvidas lidas
  const aproximada = !respondidos.size && daCreator.length > 0;
  const taxa = duvidas ? Math.min(100, Math.round(((aproximada ? daCreator.length : perguntasRespondidas) / duvidas) * 100)) : null;
  return {
    comentarios_lidos: topo.length,
    respostas_lidas: respostas.length,
    pct_duvidas: topo.length ? Math.round((duvidas / topo.length) * 100) : null,
    pct_perguntas: topo.length ? Math.round((perguntas / topo.length) * 100) : null,
    pct_pedidos: topo.length ? Math.round((pedidos / topo.length) * 100) : null,
    respostas_creator: daCreator.length,
    taxa_resposta: taxa,
    taxa_aproximada: aproximada,
    exemplos,
  };
}

/** A frase que a ficha mostra — nos moldes do exemplo do cliente. */
export function leituraConversa(vol, cont) {
  if (!vol) return null;
  const partes = [];
  const nivel = vol.indice_faixa == null ? null : vol.indice_faixa >= 1.5 ? "alta" : vol.indice_faixa >= 0.8 ? "na média" : "baixa";
  if (nivel) {
    partes.push(nivel === "na média"
      ? `Esta creator recebe uma média de comentários na média dos perfis do mesmo tamanho (${vol.media_comentarios} por peça, contra ${vol.mediana_faixa} na faixa ${vol.faixa}).`
      : `Esta creator recebe uma média de comentários considerada ${nivel} para perfis do mesmo tamanho (${vol.media_comentarios} por peça, contra ${vol.mediana_faixa} na faixa ${vol.faixa}).`);
  } else {
    partes.push(`Esta creator recebe em média ${vol.media_comentarios} comentários por peça.`);
  }
  if (vol.consistencia != null) {
    partes.push(vol.consistencia >= 60 ? "O volume é consistente entre conteúdos." : vol.consistencia >= 30 ? "O volume varia bastante entre conteúdos." : "O volume concentra-se em poucas peças.");
  }
  if (cont?.pct_duvidas != null) {
    partes.push(cont.pct_duvidas >= 25
      ? `Uma parcela relevante das interações (${cont.pct_duvidas}%) contém dúvidas e pedidos de recomendação, indicando que a audiência a reconhece como fonte de informação sobre o tema.`
      : cont.pct_duvidas >= 10
        ? `${cont.pct_duvidas}% dos comentários lidos trazem dúvidas ou pedidos de recomendação.`
        : `Poucos comentários (${cont.pct_duvidas}%) trazem dúvidas ou pedidos — a conversa é mais de reação do que de consulta.`);
    if (cont.taxa_resposta != null) {
      partes.push(cont.taxa_resposta >= 50 ? `A creator responde a ${cont.taxa_resposta}% dessas dúvidas.` : cont.taxa_resposta > 0 ? `A creator responde a ${cont.taxa_resposta}% dessas dúvidas.` : "Nas peças lidas, a creator não respondeu às dúvidas.");
    }
  }
  return partes.join(" ");
}
