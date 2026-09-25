/**
 * SCORE KOL — motor em 3 camadas do briefing L'Oréal (§8), explicável fator a fator.
 *
 *  Camada 1 · ELEGIBILIDADE (corte): território ≥50% + consistência mínima + sem red flag grave.
 *             Consistência é REGULARIDADE (% de posts com views acima da mediana dos pares),
 *             não nível de engajamento — o briefing separa as duas, e o engajamento relativo
 *             é dimensão pontuada, não portão. Corrigido jul/2026; ver o corte em kolScore().
 *  Camada 2 · SCORE PONDERADO (0–100): fatores por ordem de peso do briefing —
 *             território > performance relativa > autoridade social > aderência de audiência > qualidade.
 *  Camada 3 · SATURAÇÃO: camada SEPARADA (briefing §8.4) — nível de alerta com evidências;
 *             nunca desconta o score.
 *
 * Convive com o Radar Score: o Radar mede "quem está a subir" (funil); o Score KOL mede
 * "quem serve este briefing" (decisão do plano, 25/07/2026). Não fundir.
 *
 * Puro e testável: sem I/O, sem Date.now() — a data de referência entra por opts.hoje.
 * Fatores sem dados NÃO viram nota zero: o peso é renormalizado entre os disponíveis e a
 * ausência fica assinalada no breakdown (decisão do plano — nunca nota "fantasma").
 *
 * Autoridade social v1 é PROXY (audiência notável + credibilidade do influencers.club) —
 * menções externas ("KOL dos KOLs" completo) ficam para v2 pós-15/08. Limitação documentada.
 */
import { marcaConcorrente } from "./concorrentes.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const has = (v) => v != null && Number.isFinite(Number(v));

// ───────────────────────── CONFIG (calibrável — Onda 1/4 do plano) ─────────────────────────
export const CONFIG = {
  versao: "v1",
  cortes: {
    territorio_min: 50,   // briefing §8.2: >50% do conteúdo na categoria
    consistencia_min: 30, // % de posts com VIEWS acima da mediana dos pares (não pico isolado)
    pares_min: 15,        // pares no bucket×faixa abaixo dos quais a mediana não serve de corte
    // eng_index_min saiu daqui (jul/2026). O briefing pede consistência como corte
    // ("acima da mediana dos pares, não pico isolado") e engajamento relativo como
    // DIMENSÃO PONTUADA — ver o comentário do corte `consistencia` em kolScore().
  },
  // pesos na ordem do briefing §8.3 (território é o maior). Somam 100.
  pesos: { territorio: 35, performance: 25, autoridade: 15, aderencia: 15, qualidade: 10 },
  // âncoras de normalização (percentis da base em 25/07: notáveis p10/50/90 = 22/42/58 · cred = 51/77/85)
  autoridade: { notaveis: [10, 70], credibilidade: [40, 95] },
  aderencia: { genero_pleno: 80, faixa_pleno: 85, brasil_pleno: 85 },
  saturacao: {
    peso_tipo: { publi: 3, afiliado: 2, seeding: 1, organica: 0.5 },
    niveis: { alta: 6, media: 3 }, // pontos; >0 = baixa; 0 = nenhuma
  },
  classes: {
    kol: { score: 68, territorio: 60, autoridade: 50 },
    rising_star: { score: 55, growth30_pct: 6, followers_max: 400000 },
    hidden_gem: { score: 58, eng_index: 1.25, follower_pct_max: 0.45 },
    brand_safe: { score: 45, consistencia: 50 },
  },
};

const CLASSE_LABEL = {
  kol: "👑 KOL — autoridade do território",
  rising_star: "★ Rising Star — em aceleração",
  hidden_gem: "💎 Hidden Gem — pequena que entrega",
  brand_safe_performer: "🛡 Brand Safe Performer — consistente e segura",
  elegivel: "◇ Elegível — passa o corte, sem classe destacada",
};

// nichos do brand_history são restritos aos 6 territórios do radar
const TERRITORIO_RX = {
  beauty: /skincare|maquiagem|cabelo|perfum|unha|beleza/i, // tudo menos Lifestyle
  cabelo: /cabelo/i,
  skincare: /skincare/i,
  maquiagem: /maquiagem/i,
  perfumaria: /perfum/i,
  unhas: /unha/i,
};

/** % do conteúdo dentro do território pedido (soma nichos que casam; "beauty" = união dos 5). */
export function territorioPct(nichos, territorio = "beauty") {
  if (!Array.isArray(nichos) || !nichos.length) return null;
  const rx = TERRITORIO_RX[territorio] || TERRITORIO_RX.beauty;
  const soma = nichos.filter((n) => rx.test(String(n?.nicho || ""))).reduce((s, n) => s + (Number(n.pct) || 0), 0);
  return clamp(Math.round(soma), 0, 100);
}

// ───────────────────────── Camada 3 · Saturação (separada do score) ─────────────────────────
export function saturacaoConcorrentes(brandHistory, { hoje }) {
  const marcas = brandHistory?.marcas;
  if (!Array.isArray(marcas)) return { nivel: "sem_dados", pontos: 0, evidencias: [], interna: [], janela: "12m" };
  const ref = new Date((hoje || "2026-01-01") + "T12:00:00");
  const recencia = (ultima) => {
    if (!ultima) return 0.75;
    const dias = (ref - new Date(ultima + "T12:00:00")) / 864e5;
    if (!Number.isFinite(dias)) return 1;
    if (dias < 0) return 2; // data futura/relógio adiantado — tratar como muito recente
    if (dias <= 90) return 2;
    if (dias <= 180) return 1.5;
    if (dias <= 365) return 1;
    return 0.5;
  };
  let pontos = 0;
  const evidencias = [], interna = [];
  for (const m of marcas) {
    const hit = marcaConcorrente(m?.marca);
    if (!hit) continue;
    const pesoTipo = CONFIG.saturacao.peso_tipo[m.tipo] ?? 0.5;
    const extraVids = 1 + clamp(((Number(m.videos) || 1) - 1) * 0.25, 0, 0.5);
    const pts = r1(pesoTipo * recencia(m.ultima) * extraVids);
    const ev = { marca: hit.label, grupo: hit.grupo, tipo: m.tipo, videos: m.videos ?? null, ultima: m.ultima ?? null, pontos: pts };
    if (hit.interna) interna.push(ev);           // L'Oréal: reportada à parte, não pontua (pergunta aberta nº1)
    else { pontos += pts; evidencias.push(ev); }
  }
  pontos = r1(pontos);
  const { alta, media } = CONFIG.saturacao.niveis;
  const nivel = pontos >= alta ? "alta" : pontos >= media ? "media" : pontos > 0 ? "baixa" : "nenhuma";
  evidencias.sort((a, b) => b.pontos - a.pontos);
  return { nivel, pontos, evidencias, interna, janela: "12m" };
}

// ───────────────────────── Motor principal ─────────────────────────
/**
 * @param dossie  { followers, kol_screen, brand_history, audience, growth30_pct }
 * @param opts    { territorio: 'beauty'|'cabelo'|..., publico: 'feminino'|'masculino', hoje: 'YYYY-MM-DD' }
 */
export function kolScore(dossie, opts = {}) {
  const territorio = opts.territorio || "beauty";
  const publico = opts.publico || "feminino";
  const hoje = opts.hoje || "2026-01-01";
  const ks = dossie?.kol_screen || {};
  const met = ks.metricas || {};
  const bh = dossie?.brand_history || {};
  const aud = dossie?.audience || null;
  // dados de produção podem vir malformados: comercial como objeto, entradas null, etc.
  const comercial = (Array.isArray(ks.comercial) ? ks.comercial : []).filter((c) => c && c.id);
  const followers = Number(dossie?.followers) || 0;
  const growth30 = has(dossie?.growth30_pct) ? Number(dossie.growth30_pct) : null;

  // ── Camada 1 · Elegibilidade ──
  const tPct = territorioPct(bh.nichos, territorio);
  const consist = has(met.consistency_pct) ? Number(met.consistency_pct) : null;
  const engIdx = has(met.eng_index) ? Number(met.eng_index) : null;
  // n_peer: quantos creators formam a mediana do bucket×faixa. Um corte assente numa
  // mediana de meia dúzia de observações reprova por ruído, não por mérito.
  //
  // Desconhecido ≠ poucos: `n_peer` só passou a ser gravado em jul/2026, e os kol_screen
  // anteriores não o têm. Tratar null como "poucos pares" desligava o corte para a base
  // inteira — medido em dry-run, os elegíveis saltavam de 335 para 1046 por este motivo e
  // não pelo mérito da correção. Sem saber, avalia-se como sempre se avaliou.
  const nPeer = has(met.n_peer) ? Number(met.n_peer) : null;
  const paresInsuficientes = nPeer != null && nPeer < CONFIG.cortes.pares_min;
  const betFlag = comercial.find((c) => c.id === "bets")?.resultado === "red flag";

  const C = CONFIG.cortes;
  const cortes = [
    {
      id: "territorio", criterio: `Afinidade de território ≥ ${C.territorio_min}%`,
      valor: tPct, limite: C.territorio_min, passou: tPct != null && tPct >= C.territorio_min,
      razao: tPct == null
        ? "Sem scan de território (brand_history.nichos) — rodar brand-scan antes de avaliar."
        : `${tPct}% do conteúdo em ${territorio === "beauty" ? "beauty (5 territórios)" : territorio} — ${tPct >= C.territorio_min ? "cruza" : "não cruza"} a linha de ${C.territorio_min}%.`,
    },
    // Consistência = REGULARIDADE, e só isso. O corte exigia também engajamento ≥0.8× a
    // mediana, o que não está no briefing: lá a consistência é o corte ("acima da mediana
    // dos pares, não pico isolado") e o engajamento relativo é uma dimensão PONTUADA. O
    // engajamento não sai do modelo — continua a valer 70% do fator "Performance relativa"
    // (peso 25). O que deixa de acontecer é ser cobrado duas vezes, uma delas como portão.
    //
    // O caso que expôs isto: @cabeleireirocalvo, 100% dos posts acima da mediana de views
    // dos pares — regularidade máxima — reprovado por 0.58× de engajamento, medido contra
    // SEIS pares. Uma taxa de engajamento mais baixa é aliás o esperado num mega.
    //
    // E o rótulo dizia "posts acima da mediana dos pares" sem dizer de quê, o que se lia
    // como engajamento. A view creator_metrics calcula
    // `avg((v.views > p.views_peer)::int)` — é mediana de VIEWS. O critério passa a dizê-lo.
    {
      id: "consistencia", criterio: `Consistência mínima (≥ ${C.consistencia_min}% dos posts com views acima da mediana dos pares)`,
      valor: consist, limite: C.consistencia_min,
      // Sem pares que cheguem, a mediana não é critério — é ruído. Não reprova ninguém:
      // fica por avaliar e diz-se porquê, como o d143c36 fez à autoridade sem audiência.
      passou: consist == null ? false : (paresInsuficientes || consist >= C.consistencia_min),
      nao_avaliado: consist != null && paresInsuficientes,
      razao: consist == null
        ? "Sem métricas de performance (view creator_metrics) — perfil ainda não comparado aos pares."
        : paresInsuficientes
          ? `Só ${nPeer} pares em ${met.niche_bucket || "?"}×${met.band || "?"} — abaixo dos ${C.pares_min} que a mediana precisa para servir de corte. A consistência (${consist}%) fica registada mas não reprova.`
          : `${consist}% dos posts têm views acima da mediana dos pares${nPeer != null ? ` (${nPeer} pares)` : ""} — ${consist >= C.consistencia_min ? "performance recorrente, não pico isolado" : "abaixo do piso de recorrência"}.`,
    },
    {
      id: "brand_safety", criterio: "Sem red flags graves (casas de aposta / BETs)",
      valor: betFlag ? "red flag" : "limpo", limite: "limpo", passou: !betFlag,
      razao: betFlag
        ? `Menção a casas de aposta detectada — ${comercial.find((c) => c.id === "bets")?.detalhe || "revisar"}.`
        : "Nenhuma menção a casas de aposta no último ano de conteúdo.",
    },
  ];
  const elegivel = cortes.every((c) => c.passou);

  // ── Camada 2 · Score ponderado (fatores na ordem de peso do briefing) ──
  const fatores = [];

  // 1) Território (peso maior — briefing §8.3)
  fatores.push({
    id: "territorio", label: "Afinidade de território", peso: CONFIG.pesos.territorio,
    disponivel: tPct != null, nota: tPct != null ? tPct : null, valor: tPct != null ? `${tPct}%` : null,
    razao: tPct == null ? "Sem scan de nichos — peso redistribuído."
      : `${tPct}% do conteúdo no território do briefing${tPct >= 80 ? " — especialista de nicho" : tPct >= 60 ? " — foco forte" : " — foco moderado"}.`,
  });

  // 2) Performance relativa (eng vs pares + consistência; shares/saves têm baixa cobertura — caveat)
  let notaPerf = null, razaoPerf = "Sem métricas vs pares — peso redistribuído.";
  if (engIdx != null || consist != null) {
    const nEng = engIdx != null ? clamp(engIdx / 2, 0, 1) * 100 : null;     // 2× a mediana = 100 · mediana = 50
    const nCon = consist != null ? clamp(consist, 0, 100) : null;
    notaPerf = r1(nEng != null && nCon != null ? 0.7 * nEng + 0.3 * nCon : (nEng ?? nCon));
    razaoPerf = `${engIdx != null ? `Engajamento ${engIdx}× a mediana do nicho×faixa` : "Eng. sem dado"}${consist != null ? ` · ${consist}% dos posts acima da mediana` : ""}. Base (likes+comentários)/views — shares/saves priorizados quando houver cobertura (hoje é baixa).`;
  }
  fatores.push({
    id: "performance", label: "Performance relativa aos pares", peso: CONFIG.pesos.performance,
    disponivel: notaPerf != null, nota: notaPerf, valor: engIdx != null ? `${engIdx}× mediana` : null, razao: razaoPerf,
  });

  // 3) Autoridade social — PROXY v1 (limitação documentada no plano)
  const notaveis = has(aud?.notaveis_pct) ? Number(aud.notaveis_pct) : null;
  const cred = has(aud?.credibilidade_pct) ? Number(aud.credibilidade_pct) : null;
  let notaAut = null, razaoAut = "Sem dados de audiência (influencers.club) — peso redistribuído.";
  if (notaveis != null || cred != null) {
    const [n0, n1] = CONFIG.autoridade.notaveis, [c0, c1] = CONFIG.autoridade.credibilidade;
    const nNot = notaveis != null ? clamp((notaveis - n0) / (n1 - n0), 0, 1) * 100 : null;
    const nCred = cred != null ? clamp((cred - c0) / (c1 - c0), 0, 1) * 100 : null;
    notaAut = r1(nNot != null && nCred != null ? 0.6 * nNot + 0.4 * nCred : (nNot ?? nCred));
    razaoAut = `Proxy v1: ${notaveis != null ? `${notaveis}% de audiência notável (perfis relevantes a seguir)` : "notáveis sem dado"}${cred != null ? ` · credibilidade ${cred}%` : ""}. Menções externas ("KOL dos KOLs" completo) entram na v2.`;
  }
  fatores.push({
    id: "autoridade", label: "Autoridade social (proxy v1)", peso: CONFIG.pesos.autoridade,
    disponivel: notaAut != null, nota: notaAut, valor: notaveis != null ? `${notaveis}% notáveis` : null, razao: razaoAut,
  });

  // 4) Aderência de audiência (briefing: mulheres 18-45 nacional · masculino no 2º briefing)
  let notaAde = null, razaoAde = "Sem demografia de audiência — peso redistribuído.";
  if (aud) {
    const generoPct = publico === "masculino"
      ? (() => {
          const m = (Array.isArray(aud.generos) ? aud.generos : []).find((g) => g && g.code === "MALE");
          if (m && has(m.weight)) return Math.round(Number(m.weight) * 1000) / 10;
          return has(aud.mulheres_pct) ? r1(100 - Number(aud.mulheres_pct)) : null;
        })()
      : (has(aud.mulheres_pct) ? Number(aud.mulheres_pct) : null);
    const faixa = has(aud.faixa_18_45_pct) ? Number(aud.faixa_18_45_pct) : null;
    const brasil = has(aud.brasil_pct) ? Number(aud.brasil_pct) : null;
    const A = CONFIG.aderencia;
    const partes = [
      generoPct != null ? { w: 0.4, n: clamp(generoPct / A.genero_pleno, 0, 1) * 100 } : null,
      faixa != null ? { w: 0.3, n: clamp(faixa / A.faixa_pleno, 0, 1) * 100 } : null,
      brasil != null ? { w: 0.3, n: clamp(brasil / A.brasil_pleno, 0, 1) * 100 } : null,
    ].filter(Boolean);
    if (partes.length) {
      const wSum = partes.reduce((s, p) => s + p.w, 0);
      notaAde = r1(partes.reduce((s, p) => s + p.w * p.n, 0) / wSum);
      razaoAde = `Público-alvo ${publico}: ${generoPct != null ? `${generoPct}% ${publico === "masculino" ? "homens" : "mulheres"}` : "género s/ dado"}${faixa != null ? ` · ${faixa}% em 18-45` : ""}${brasil != null ? ` · ${brasil}% Brasil` : ""}.`;
    }
  }
  fatores.push({
    id: "aderencia", label: `Aderência de audiência (${publico})`, peso: CONFIG.pesos.aderencia,
    disponivel: notaAde != null, nota: notaAde, valor: null, razao: razaoAde,
  });

  // 5) Qualidade & segurança (red flags leves reduzem, não eliminam — briefing §8.3)
  const satGeralR = comercial.find((c) => c.id === "sat")?.resultado || null;
  const beRatio = has(bh?.brand_engagement?.ratio) ? Number(bh.brand_engagement.ratio) : null;
  let notaQ = null, razaoQ = "Sem sinais de qualidade — peso redistribuído.";
  if (satGeralR != null || beRatio != null || cred != null) {
    let q = 100; const motivos = [];
    if (satGeralR === "red flag") { q -= 30; motivos.push("volume alto de publis no último ano (−30)"); }
    else if (satGeralR === "moderada") { q -= 10; motivos.push("volume moderado de publis (−10)"); }
    if (beRatio != null && beRatio < 0.85) { q -= 20; motivos.push(`publi engaja ${Math.round((1 - beRatio) * 100)}% abaixo do orgânico (−20)`); }
    if (cred != null && cred < 60) { q -= 20; motivos.push(`credibilidade de audiência baixa ${cred}% (−20)`); }
    notaQ = clamp(q, 0, 100);
    razaoQ = motivos.length ? `Red flags leves: ${motivos.join(" · ")}.` : "Sem red flags leves — histórico comercial e audiência saudáveis.";
  }
  fatores.push({
    id: "qualidade", label: "Qualidade & segurança", peso: CONFIG.pesos.qualidade,
    disponivel: notaQ != null, nota: notaQ, valor: null, razao: razaoQ,
  });

  // Renormalização dos pesos entre fatores disponíveis (nunca nota "fantasma")
  const disponiveis = fatores.filter((f) => f.disponivel);
  const somaPesos = disponiveis.reduce((s, f) => s + f.peso, 0) || 1;
  for (const f of fatores) f.peso_norm = f.disponivel ? r1((f.peso / somaPesos) * 100) : 0;
  const score = disponiveis.length ? r1(disponiveis.reduce((s, f) => s + (f.peso / somaPesos) * f.nota, 0)) : null;

  // Cobertura: quanto do peso declarado estava mesmo disponível. O score renormaliza
  // sempre para 0-100, por isso 62 medido com 3 fatores e 62 medido com 5 saem iguais
  // no ecrã e NÃO são a mesma coisa. Sem este número não há como comparar dois creators
  // nem filtrar os que ficaram por medir quando um fornecedor falha.
  const pesoTotal = fatores.reduce((s, f) => s + f.peso, 0) || 100;
  const cobertura_pct = r1((somaPesos / pesoTotal) * 100);

  // ── Camada 3 · Saturação (separada — não toca no score) ──
  const saturacao = saturacaoConcorrentes(bh, { hoje });

  // ── Classe (4 tipos do briefing; thresholds em CONFIG.classes, calibráveis) ──
  const fpct = has(met.follower_pct) ? Number(met.follower_pct) : null;
  const K = CONFIG.classes;
  let classe = null, classeRazao = "";
  if (elegivel && score != null) {
    const notaTer = tPct ?? 0, notaA = notaAut ?? 0;
    if (score >= K.kol.score && notaTer >= K.kol.territorio && notaA >= K.kol.autoridade && (fpct == null || fpct >= 0.4 || followers >= 100000)) {
      classe = "kol"; classeRazao = `Score ${score} com território ${notaTer}% e autoridade ${notaA} — referência estabelecida do território.`;
    } else if (score >= K.rising_star.score && growth30 != null && growth30 >= K.rising_star.growth30_pct && followers < K.rising_star.followers_max) {
      classe = "rising_star"; classeRazao = `Crescimento +${r1(growth30)}%/30d com score ${score} e base ainda em construção (${Math.round(followers / 1000)}k) — janela de aceleração.`;
    } else if (score >= K.hidden_gem.score && engIdx != null && engIdx >= K.hidden_gem.eng_index && (fpct == null || fpct <= K.hidden_gem.follower_pct_max) && ["nenhuma", "baixa", "sem_dados"].includes(saturacao.nivel)) {
      classe = "hidden_gem"; classeRazao = `Engaja ${engIdx}× a mediana com base pequena no nicho e exposição comercial baixa — joia por descobrir.`;
    } else if (score >= K.brand_safe.score && consist != null && consist >= K.brand_safe.consistencia) {
      classe = "brand_safe_performer"; classeRazao = `Consistência ${consist}% com histórico limpo — entrega previsível e segura para a marca.`;
    } else {
      classe = "elegivel"; classeRazao = `Passa os cortes com score ${score}, sem os picos que definem as 4 classes destacadas.`;
    }
  }

  // A classe KOL exige autoridade ≥ 50, e a autoridade só existe com dados de audiência.
  // Quando esses dados faltam, `notaAut ?? 0` faz a condição reprovar — e o creator sai
  // classificado como se tivesse sido avaliado e ficado aquém. Não foi: não foi medido.
  // A regra do cliente fica intacta (a classe atribuída não muda); o que se acrescenta é
  // dizer que o veredicto de KOL não chegou a ser possível, para ninguém ler a classe
  // inferior como julgamento. É isto que separa "não é KOL" de "não deu para saber".
  const autoridadeIndisponivel = !fatores.find((f) => f.id === "autoridade")?.disponivel;
  const kol_nao_avaliavel = Boolean(
    elegivel && score != null && classe !== "kol" && autoridadeIndisponivel &&
    score >= K.kol.score && (tPct ?? 0) >= K.kol.territorio
  );
  if (kol_nao_avaliavel) {
    classeRazao += ` ATENÇÃO: score e território cumprem o exigido para KOL, mas a autoridade não pôde ser calculada por falta de dados de audiência — a classe KOL não foi avaliada, não foi recusada.`;
  }

  return {
    versao: CONFIG.versao,
    territorio, publico,
    elegivel, cortes,
    score: elegivel ? score : null,
    score_bruto: score, // calculado mesmo quando inelegível, para diagnóstico/calibração
    fatores,
    fatores_indisponiveis: fatores.filter((f) => !f.disponivel).map((f) => f.id),
    cobertura_pct, kol_nao_avaliavel,
    classe, classe_label: classe ? CLASSE_LABEL[classe] : null, classe_razao: classeRazao,
    saturacao,
    calculado_em: hoje,
  };
}
