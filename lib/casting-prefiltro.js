// PRÉ-FILTRO DO CASTING — quem entra no pool antes do campaignEval (app/api/campaign).
//
// Saiu do route (feedback rodada 2, F1.2 — set/2026) sem mudar uma regra: o "Mais nomes"
// (mesmo route, modo alargado) e o test-busca.mjs (fixture dos seis temas do cliente,
// corre fora do Next) precisam de calcular o MESMO pool por palavras-chave para o comparar
// com o pool alargado pela busca semântica. Imports relativos pelo mesmo motivo.
//
// O que está aqui decide só QUEM é avaliado; o fit, os pesos e os multiplicadores
// continuam no campaignEval do route (aprovados pelo cliente).

export const NICHE_TERMS = {
  cabelo: ["cabelo","cabelos","capilar","hair","fios","cacho","cachos","crespo","crespos","loiro","mechas","liso","progressiva","tran[çc]a","trancas","trança","mega hair","fibra","volume","densidade","queda","finaliza","cronograma","colora","ruivo"],
  maquiagem: ["maquiagem","make","makeup","batom","base","rimel","rímel","sombra","contorno","blush","delineado","glam"],
  skincare: ["skincare","skin care","pele","dermo","serum","sérum","hidratante facial","acne","poros","protetor solar","colageno facial","antissinais"],
  unhas: ["unha","unhas","nail","nails","esmalte","manicure"],
  perfume: ["perfume","perfumaria","fragrancia","fragrância","fragrance","cheiro"],
  cilios: ["cilios","cílios","lash","lashes","extensão de cílios"],
  estetica: ["estetica","estética","botox","preenchimento","harmonizacao","harmonização","procedimento","dermato"],
};

export function bucketFromText(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase();
  let best = null, bestN = 0;
  for (const [b, terms] of Object.entries(NICHE_TERMS)) {
    let n = 0; for (const w of terms) { try { if (new RegExp(w).test(t)) n++; } catch { if (t.includes(w)) n++; } }
    if (n > bestN) { bestN = n; best = b; }
  }
  return bestN >= 1 ? best : null;
}

// % do conteúdo da creator dentro do território do brief (considera nichos secundários, não só o dominante)
export function briefPctOf(nichosArr, briefBucket) {
  if (!briefBucket || !Array.isArray(nichosArr)) return 0;
  let p = 0;
  for (const n of nichosArr) { if (bucketFromText(n?.nicho) === briefBucket) p = Math.max(p, Number(n?.pct) || 0); }
  return p;
}
export const SECONDARY_MIN = 10; // % mínimo no território pra entrar como candidata secundária

/** Território do brief pelo vocabulário dos nichos (keywords + território + nome + texto). */
export const briefBucketDe = (parsed, briefing) =>
  bucketFromText([(parsed?.keywords ?? []).join(" "), parsed?.territorio, parsed?.nome, briefing].filter(Boolean).join(" "));

/** Linha resumida de um creator da casting_base — o que o pré-filtro lê. */
export function linhaRadar(c, marcaAlvo) {
  const bh = c.brand_history || {};
  const ks = c.kol_screen || {};
  return {
    id: c.id,
    handle: c.handle, nome: c.name, plataforma: c.platform, seguidores: c.followers,
    classe: ks.classe ?? null,
    nicho_bucket: ks.metricas?.niche_bucket ?? null,
    dominancia_nicho_pct: ks.metricas?.niche_density ?? null,
    eng_index: ks.metricas?.eng_index ?? null,
    nichos: (bh.nichos ?? []).map((n) => `${n.nicho} ${n.pct}%`).join(", ") || c.niche || c.category,
    nichos_arr: bh.nichos ?? [],
    score: c.score_total ?? null,
    fit_marca: c.fit_marca != null ? `${marcaAlvo} ${Number(c.fit_marca)}/100` : null,
    marcas: (bh.marcas ?? []).slice(0, 6).map((m) => m.marca).join(", ") || null,
    resumo_comercial: bh.resumo?.slice(0, 140) ?? null,
  };
}

/**
 * Pool por palavras-chave: todo o creator do território (mesmo bucket do brief, ou ≥10%
 * em nicho secundário) OU quem casa keyword — menos os cortados por "o que não queremos".
 * → { radarMatch, excluidos, excluido(r), kwsLow, casados }
 */
export function preFiltro(radar, parsed, briefBucket) {
  // pré-filtro de território: cruza keywords do briefing com nicho/marcas da creator (evita mandar 1000 dossiês pro Claude → timeout)
  const kwsLow = (parsed.keywords ?? []).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length > 2);
  const hayDe = (r) => `${r.nichos || ""} ${r.nicho_bucket || ""} ${r.marcas || ""} ${r.nome || ""}`.toLowerCase();
  const relevancia = (r) => {
    const hay = hayDe(r);
    let hits = 0;
    for (const k of kwsLow) { if (hay.includes(k) || k.split(/[ /]/).some((w) => w.length > 3 && hay.includes(w))) hits++; }
    return hits;
  };
  // "O que não queremos" — exclusão DURA, não penalização. Quem escreve "sem contas de
  // salão" ou "sem concorrente X" não está a pedir que apareçam mais abaixo: está a dizer
  // que não servem. Corta antes do ranking (nichos, marcas citadas e nome da creator), e o
  // número de cortes volta na resposta para o pedido não parecer simplesmente magro.
  const negLow = (parsed.negativos ?? []).map((n) => String(n).toLowerCase().trim()).filter((n) => n.length > 2);
  const excluido = (r) => { const hay = hayDe(r); return negLow.some((n) => hay.includes(n)); };
  // candidato = TODO creator do território (mesmo bucket do brief) OU quem casa keyword — assim todos os KOLs do nicho entram, não só os que citam o termo exato
  const inBucket = (r) => !!briefBucket && (r.nicho_bucket === briefBucket || briefPctOf(r.nichos_arr, briefBucket) >= SECONDARY_MIN);
  const excluidos = negLow.length ? radar.filter(excluido).length : 0;
  const ranked = (negLow.length ? radar.filter((r) => !excluido(r)) : radar)
    .map((r) => ({ r, rel: relevancia(r), inB: inBucket(r), score: Number(r.score) || 0, isKol: r.classe === "kol" || r.classe === "rising_star" }))
    .sort((a, b) => ((b.inB ? 1 : 0) - (a.inB ? 1 : 0)) || (b.rel - a.rel) || (b.isKol - a.isKol) || (b.score - a.score));
  // cap do pool: era 260 quando os dossiês iam ao Claude (timeout); a seleção passou a ser
  // determinística, então o cap é só guarda de sanidade — o corte real é o top-150 por fit.
  // Com 260, os ~1.1k candidatos de cabelo cortavam recém-promovidos antes da avaliação.
  const casados = ranked.filter((x) => x.inB || x.rel > 0);
  const pool = casados.slice(0, 1200).map((x) => x.r);
  const radarMatch = pool.length >= 15 ? pool : ranked.slice(0, 90).map((x) => x.r);
  // `casados`: quantos casaram antes do cap (diagnóstico do test-busca.mjs e do "Mais nomes")
  return { radarMatch, excluidos, excluido, kwsLow, casados: casados.length };
}

// Faixas de seguidores (as do Tier proposto na D11): o "Mais nomes" alarga a faixa do
// briefing um degrau para cada lado. 0 = sem limite, como em parsed.faixa_min/faixa_max.
export const FAIXAS = [0, 10_000, 50_000, 200_000, 1_000_000];

/** { min, max } alargados uma faixa para cada lado — 10k–50k → 0–200k; 200k–0 → 50k–0. */
export function alargarFaixa(min, max) {
  const lo = Number(min) || 0, hi = Number(max) || 0;
  const abaixo = [...FAIXAS].reverse().find((f) => f < lo) ?? 0;
  const acima = hi ? FAIXAS.find((f) => f > hi) ?? 0 : 0;
  return { min: lo ? abaixo : 0, max: acima };
}
