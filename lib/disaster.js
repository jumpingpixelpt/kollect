/**
 * DISASTER CHECK — varredura de risco reputacional sobre o conteúdo que temos.
 *
 * Duas honestidades que o painel tem de manter, e que são a razão de este módulo existir
 * em vez de uma lista de ✓ verdes:
 *
 *  1. AUSÊNCIA DE TERMO NÃO É AUSÊNCIA DE RISCO. A varredura lê o que temos escrito —
 *     legendas, falas transcritas e a bio. Um creator sem transcrição nenhuma dá "nada
 *     encontrado" em todas as categorias sem que nada tenha sido verificado; por isso o
 *     resultado carrega sempre a BASE (quantas peças, quantas com fala) e a base entra no
 *     ecrã ao lado do veredicto.
 *  2. TERMO ENCONTRADO NÃO É VEREDICTO. "Racismo" aparece tanto em quem o pratica como em
 *     quem o denuncia. Uma categoria com achados fica em "a rever" com os trechos à vista,
 *     para leitura humana — nunca em "reprovado".
 *
 * As três categorias que exigem fontes que não temos (registos judiciais, base eleitoral,
 * idade do titular) ficam explicitamente NÃO VERIFICADAS e não contam como limpas. As
 * fontes desta plataforma são TikTok e Instagram via Apify/Tubular — nenhuma delas expõe
 * esses dados.
 */

const BORDA = "[^0-9a-zà-ÿ]";
// Compilada uma vez por termo: a varredura corre peças × categorias × termos a cada
// render da ficha, e construir a expressão dentro do laço era o grosso do custo.
const _rx = new Map();
// Termos curtos (≤ 4 letras: bet, odd, slot, banca…) levam fronteira também no fim — "bet"
// casava "bettdow" (um fone de ouvido) e marcava apostas (lote de 11/09/2026). Os longos
// ficam como prefixo de propósito: "homof[óo]bic" apanha homofóbico/a.
const rx = (termo) => {
  if (!_rx.has(termo)) {
    const fim = termo.replace(/[^a-zà-ÿ]/gi, "").length <= 4 ? `(?=$|${BORDA})` : "";
    try { _rx.set(termo, new RegExp(`(^|${BORDA})(${termo})${fim}`, "i")); }
    catch { _rx.set(termo, null); }
  }
  return _rx.get(termo);
};
const bate = (texto, termo) => {
  const r = rx(termo);
  return r ? r.test(texto) : texto.includes(termo);
};

// `peso` = quanto a categoria pesa no índice de risco (0–100). "contexto" e "restricao"
// não são risco de marca: são informação de adequação de campanha e pesam 0 de propósito.
export const CATEGORIAS = [
  {
    id: "bets", nome: "Bets e jogos de azar", tipo: "risco", peso: 30,
    // "aposta/apostar" sozinhos saíram (11/09/2026): "apostaria nessas fragrâncias" marcava o
    // Alan Vivian; "blaze" e "roleta" só com contexto de jogo (a Glei Souza tinha "blaze" na
    // fala sem casa de apostas); "banca" saiu (banca examinadora). Os nomes de casas ficam.
    termos: ["bet", "bets", "casas? de apostas?", "sites? de apostas?", "plataformas? de apostas?", "apostas? (esportivas?|online|desportivas?)", "aposta m[íi]nima", "b[ôo]nus de apostas?", "c[óo]digo de apostas?", "cassino", "casino", "blaze[^.]{0,40}(aposta|cassino|crash|double|ganh)", "(jog(ar|o|ando|uei)|aposta)[^.]{0,30}(no|na) blaze", "tigrinho", "fortune tiger", "jogo do bicho", "pixbet", "betano", "bet365", "esportes da sorte", "raspadinha", "roleta[^.]{0,30}(aposta|cassino|blaze)", "slot", "odd", "odds", "green e red", "sinal de jogo"],
    limpo: "Nenhuma menção a casas de aposta nas legendas e falas analisadas.",
  },
  {
    id: "odio", nome: "Discurso de ódio", tipo: "risco", peso: 40,
    termos: ["racismo", "racista", "homofobia", "homof[óo]bic", "transfobia", "transf[óo]bic", "xenofobia", "xen[óo]fob", "misoginia", "mis[óo]gin", "gordofobia", "nazista", "nazismo", "supremacia", "capacitismo"],
    limpo: "Nenhum termo de discurso de ódio nas legendas e falas analisadas.",
    nota: "A varredura acha a PALAVRA, não a posição: estes termos aparecem tanto em quem ofende como em quem denuncia. Qualquer achado é para ler, não para concluir.",
  },
  {
    id: "politica", nome: "Associação política", tipo: "risco", peso: 15,
    termos: ["bolsonaro", "lula", "eleic[ãa]o", "eleic[õo]es", "eleitoral", "deputad", "senador", "vereador", "urnas", "votar", "voto", "candidatura", "candidato", "pauta pol[íi]tica", "presidente da rep[úu]blica"],
    limpo: "Nenhuma menção eleitoral ou partidária nas legendas e falas analisadas.",
  },
  {
    id: "ativismo", nome: "Ativismo e polarização", tipo: "risco", peso: 10,
    termos: ["ativis", "ativista", "militante", "milit[âa]ncia", "manifesta[çc][ãa]o", "protesto", "boicot", "cancelad", "cancelamento", "greve"],
    limpo: "Nenhum sinal de pauta polarizadora nas legendas e falas analisadas.",
  },
  {
    id: "religiao", nome: "Pauta religiosa", tipo: "contexto", peso: 0,
    termos: ["evang[ée]lic", "gospel", "igreja", "vers[íi]culo", "cat[óo]lic", "umbanda", "candombl[ée]", "orix[áa]", "esp[íi]rita", "pastor", "missa", "culto", "deus aben[çc]oe", "b[íi]blia", "or[aã][çc][ãa]o"],
    limpo: "Nenhuma marcação religiosa nas legendas e falas analisadas.",
    nota: "Não é risco — é adequação. Marca com posicionamento laico costuma querer saber antes de aprovar.",
  },
  {
    id: "gravidez", nome: "Gravidez e lactação", tipo: "restricao", peso: 0,
    termos: ["gr[áa]vida", "gravidez", "gestante", "gesta[çc][ãa]o", "amamenta", "lactante", "puerp[ée]rio", "p[óo]s-parto"],
    limpo: "Nenhuma menção a gestação ou amamentação nas legendas e falas analisadas.",
    nota: "Não é risco de marca — é restrição de campanha: ativos como retinol e certos ácidos não se comunicam com gestante ou lactante.",
  },
];

// Fontes que a plataforma não tem ligadas. Ficam à vista para que o "baixo risco" acima
// não se leia como "verificámos tudo".
export const NAO_VERIFICAVEIS = [
  { id: "antecedentes", nome: "Antecedentes criminais", motivo: "Exige consulta a registos públicos e judiciais, que não temos ligada. CPF é dado pessoal sensível e não é recolhido por esta plataforma." },
  { id: "cargo_publico", nome: "Cargo público ou candidatura", motivo: "Exige base eleitoral oficial (TSE), não conectada." },
  { id: "menoridade", nome: "Menor de 18 anos", motivo: "Nem a Tubular nem o Apify expõem a data de nascimento do titular da conta — só a idade declarada na bio, quando existe." },
];

const NIVEL = (r) => (r === 0 ? "limpo" : r <= 15 ? "baixo" : r <= 40 ? "medio" : "alto");
export const NIVEL_LABEL = { limpo: "Nada encontrado", baixo: "Risco baixo", medio: "A rever", alto: "Risco alto" };

/** Trecho curto à volta do termo, para o operador ler sem abrir o vídeo. */
function trecho(texto, termo) {
  try {
    const m = rx(termo)?.exec(texto);
    if (!m) return null;
    const i = Math.max(0, m.index - 45);
    return (i > 0 ? "…" : "") + texto.slice(i, m.index + m[0].length + 55).replace(/\s+/g, " ").trim() + "…";
  } catch { return null; }
}

/**
 * @param bio     bio do creator
 * @param videos  linhas de `videos` (title, transcript, url, posted_at, analysis)
 */
export function disasterCheck({ bio = "", videos = [] } = {}) {
  const peças = (videos || []).map((v) => ({
    txt: [v.title, v.transcript, v.analysis?.veredicto, (v.analysis?.temas || []).join(" ")].filter(Boolean).join(" \n "),
    url: v.url, data: v.posted_at,
  }));
  const comFala = (videos || []).filter((v) => v.transcript || v.analysis).length;
  const fontes = bio ? [{ txt: bio, url: null, data: null, bio: true }, ...peças] : peças;

  const categorias = CATEGORIAS.map((cat) => {
    const evidencias = [];
    for (const f of fontes) {
      const t = f.txt.toLowerCase();
      const termo = cat.termos.find((w) => bate(t, w));
      if (!termo) continue;
      evidencias.push({ termo, trecho: trecho(f.txt, termo), url: f.url, data: f.data, bio: !!f.bio });
      if (evidencias.length >= 4) break;
    }
    const { termos, limpo, ...pub } = cat; // `termos` não vai para o cliente: é peso morto no payload
    return {
      ...pub,
      estado: evidencias.length ? "sinal" : "limpo",
      evidencias,
      detalhe: evidencias.length
        ? `${evidencias.length}${evidencias.length >= 4 ? "+" : ""} ocorrência${evidencias.length > 1 ? "s" : ""} — ler antes de decidir`
        : limpo,
    };
  });

  const risco = Math.min(100, categorias.filter((c) => c.estado === "sinal").reduce((s, c) => s + c.peso, 0));
  // Sem uma única peça com texto não se varreu nada: o veredicto é "não verificado", e não
  // o "limpo" que a soma de zero achados daria.
  const semBase = !fontes.length;

  return {
    risco, nivel: semBase ? "sem_base" : NIVEL(risco), semBase,
    categorias, naoVerificaveis: NAO_VERIFICAVEIS,
    base: { pecas: (videos || []).length, comFala, bio: !!bio },
  };
}


/**
 * Resumo gravável do disaster check (kol_screen.disaster): nível, risco e as categorias com
 * sinal. É o que o casting lê para excluir quem "não passa" (feedback do cliente, set/2026,
 * ponto 10) — risco ALTO sai da lista; MÉDIO entra sinalizado "a rever"; termo encontrado
 * continua a não ser veredicto, por isso "baixo" e "limpo" passam.
 */
export function resumoDisaster({ bio = "", videos = [] } = {}) {
  const r = disasterCheck({ bio, videos });
  return {
    nivel: r.nivel, risco: r.risco, semBase: r.semBase,
    sinais: r.categorias.filter((c) => c.estado === "sinal").map((c) => c.nome),
    pecas: r.base.pecas, verificado_em: new Date().toISOString().slice(0, 10),
  };
}

/** Regra única de "não passa no disaster check" — partilhada pelo casting e pelos cartões. */
export const chumbaDisaster = (kolScreen) => kolScreen?.disaster?.nivel === "alto";
