// Fixture da busca (feedback rodada 2, F1.2): os seis temas de teste do cliente, com os
// `temas[]` escritos À MÃO (o que o briefing-parse devolveria), contra a base VIVA.
// Imprime, por caso: candidatos pelo pré-filtro de palavras-chave (o mesmo do
// /api/campaign) × com a expansão semântica, a contagem por limiar e o top-10 por
// semelhança. Sem assertions, como o test.mjs — serve para calibrar o LIMIAR_EXPANSAO e
// para ver, antes/depois, se a busca encontra quem deve.
//
// Precisa de .env.local com GEMINI_KEY e SUPABASE_SERVICE_ROLE_KEY. Só lê (casting_base
// + busca_tema); custa ~20 embeddings.
//   node test-busca.mjs            → corte = LIMIAR_EXPANSAO
//   node test-busca.mjs 0.68       → outro corte
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  for (const l of readFileSync(new URL("./.env.local", import.meta.url), "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* sem .env.local: usa o ambiente */ }

const { preFiltro, linhaRadar, briefBucketDe } = await import("./lib/casting-prefiltro.js");
const { buscaSemantica, keywordsComTemas, LIMIAR_EXPANSAO, MAX_TEMAS } = await import("./lib/busca-semantica.js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.GEMINI_KEY) {
  console.log("Falta SUPABASE_SERVICE_ROLE_KEY ou GEMINI_KEY no .env.local"); process.exit(0);
}
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const LIMIAR = Number(process.argv[2]) || LIMIAR_EXPANSAO;
const CORTES = [0.62, 0.65, 0.68, 0.7, 0.72, 0.75];

const T = (rotulo, termos_pt, termos_en = [], situacoes = []) => ({ rotulo, termos_pt, termos_en, situacoes });
const CASOS = {
  "Baby hair for curly girls": {
    keywords: ["baby hair", "cabelo cacheado", "cachos", "finalização", "gel"],
    temas: [
      T("Baby hair em cabelo cacheado", ["baby hair", "costeletas", "finalizar baby hair", "gel para baby hair", "escovinha"], ["baby hair", "edges", "laid edges"], ["penteado com baby hair", "baby hair em cacheadas"]),
      T("Finalização de cachos", ["finalização cacheado", "definição de cachos", "fitagem", "gelatina capilar", "creme de pentear"], ["curly hair routine", "curl definition"], ["day after", "rotina de finalização"]),
      T("Cabelo crespo e transição", ["cabelo crespo", "transição capilar", "big chop", "4c"], ["type 4 hair", "natural hair"], []),
    ],
  },
  "Cabelo quebradiço por química": {
    keywords: ["quebra", "cabelo quebradiço", "química", "progressiva", "tintura"],
    temas: [
      T("Quebra por química", ["cabelo quebradiço", "quebra capilar", "corte químico", "cabelo elástico", "emborrachado"], ["hair breakage", "chemical damage"], ["depois da progressiva o cabelo quebrou"]),
      T("Descoloração e tintura", ["descoloração", "tintura", "platinado", "luzes", "mechas", "reconstrução"], ["bleached hair", "hair dye damage"], ["cabelo destruído depois de descolorir"]),
      T("Progressiva e alisamento", ["progressiva", "alisamento", "selagem", "escova progressiva", "botox capilar"], ["keratin treatment", "hair straightening"], []),
    ],
  },
  "GLP-1 (mulheres e homens)": {
    keywords: ["queda de cabelo", "ozempic", "mounjaro", "emagrecimento"],
    temas: [
      T("Queda de cabelo com GLP-1", ["ozempic", "mounjaro", "canetinha emagrecedora", "queda de cabelo", "emagrecimento rápido", "eflúvio telógeno"], ["glp-1", "semaglutide", "tirzepatide", "ozempic hair loss"], ["cabelo caindo depois de emagrecer"]),
      T("Emagrecimento e saúde capilar", ["perda de peso", "dieta", "deficiência nutricional", "vitaminas para cabelo"], ["weight loss hair loss"], []),
    ],
  },
  "Queda por tração / penteado": {
    keywords: ["alopecia de tração", "tranças", "rabo de cavalo", "queda"],
    temas: [
      T("Alopecia por tração", ["alopecia de tração", "queda por tração", "entradas", "falhas na linha do cabelo", "cabelo repuxado"], ["traction alopecia", "receding hairline"], ["tranças apertadas causando queda"]),
      T("Penteados que puxam o cabelo", ["tranças", "box braids", "rabo de cavalo apertado", "coque", "mega hair", "entrelace"], ["tight hairstyles", "braids"], []),
    ],
  },
  "Alterações hormonais": {
    keywords: ["queda pós-parto", "menopausa", "hormônios", "sop"],
    temas: [
      T("Queda pós-parto", ["queda pós-parto", "pós-parto", "amamentação", "gravidez e cabelo"], ["postpartum hair loss"], ["cabelo caindo depois do bebê"]),
      T("Menopausa e cabelo", ["menopausa", "climatério", "cabelo afinando", "reposição hormonal"], ["menopause hair"], []),
      T("Hormônios, SOP e anticoncepcional", ["sop", "ovário policístico", "anticoncepcional", "tireoide", "hormônios"], ["pcos hair loss", "hormonal hair loss"], []),
    ],
  },
  "MEN: resultados progressivos": {
    keywords: ["calvície", "minoxidil", "queda de cabelo masculina", "antes e depois"],
    temas: [
      T("Tratamento de calvície masculina", ["calvície", "minoxidil", "finasterida", "entradas", "queda de cabelo masculina"], ["male hair loss", "balding", "minoxidil results"], ["homem mostrando o antes e depois"]),
      T("Resultados progressivos antes e depois", ["antes e depois", "evolução do tratamento", "crescimento capilar", "resultado em meses"], ["hair growth progress", "before and after"], ["diário do tratamento capilar"]),
    ],
  },
};

const t0 = Date.now();
const { data: base, error } = await db.rpc("casting_base", { p_marca: null });
if (error) { console.log("casting_base:", error.message); process.exit(0); }
const byId = new Map(base.map((c) => [c.id, c]));
console.log(`base: ${base.length} creators (${((Date.now() - t0) / 1000).toFixed(1)} s) · corte = ${LIMIAR}\n`);

// controlos fora de tema, no mesmo molde: onde fica o chão de ruído de cada corte
const CONTROLOS = [
  T("xkqzv plorb", ["wrrmf", "glaxo trundle"]),
  T("Receita de bolo de cenoura", ["bolo", "cenoura", "cobertura de chocolate"]),
  T("Carros esportivos e mecânica", ["motor", "turbo", "oficina"], ["sports car"]),
];
for (const t of CONTROLOS) {
  const r = await buscaSemantica([t], { db, limiar: 0.3 });
  const sims = [...r.porCreator.values()].map((h) => h.sim);
  console.log(`controlo «${t.rotulo}»: melhor ${Math.max(0, ...sims).toFixed(3)} · ${CORTES.map((c) => `${c.toFixed(2)}→${sims.filter((s) => s >= c).length}`).join("  ")}${r.erro ? `  ERRO: ${r.erro}` : ""}`);
}
console.log("");

for (const [nome, caso] of Object.entries(CASOS)) {
  const parsed = { nome, keywords: keywordsComTemas(caso.keywords, caso.temas), negativos: [] };
  const bucket = briefBucketDe(parsed, nome);
  const radar = base.map((c) => linhaRadar(c, null));
  const soKw = preFiltro(radar, { ...parsed, keywords: caso.keywords }, briefBucketDe({ keywords: caso.keywords }, nome));
  const comTemas = preFiltro(radar, parsed, bucket);
  const kwIds = new Set(comTemas.radarMatch.map((r) => r.id));

  const sem = await buscaSemantica(caso.temas, { db, limiar: Math.min(...CORTES), max: MAX_TEMAS });
  const hits = [...sem.porCreator.entries()].sort((a, b) => b[1].sim - a[1].sim);
  const noCorte = hits.filter(([, h]) => h.sim >= LIMIAR);
  const novos = noCorte.filter(([id]) => !kwIds.has(id));

  console.log(`■ ${nome}  (território: ${bucket || "—"})${sem.erro ? `  ERRO: ${sem.erro}` : ""}`);
  console.log(`  pool só keywords do briefing: ${soKw.radarMatch.length} (casaram ${soKw.casados}) · com os termos dos temas: ${comTemas.radarMatch.length} (casaram ${comTemas.casados}) · + semântica @${LIMIAR}: ${comTemas.radarMatch.length + novos.length} (${noCorte.length} pela semântica, ${novos.length} novos)`);
  console.log(`  por limiar: ${CORTES.map((c) => `${c.toFixed(2)}→${hits.filter(([, h]) => h.sim >= c).length}`).join("  ")}`);
  console.log(`  por tema @${LIMIAR}: ${caso.temas.map((t) => `${t.rotulo} ${noCorte.filter(([, h]) => h.rotulo === t.rotulo).length}`).join(" · ")}`);
  for (const [id, h] of hits.slice(0, 10)) {
    const c = byId.get(id);
    const nicho = c?.brand_history?.nichos?.[0]?.nicho || c?.niche || "—";
    console.log(`   ${h.sim.toFixed(3)} ${h.sim >= LIMIAR ? "✓" : " "} ${kwIds.has(id) ? "kw " : "NOVO"} @${String(c?.handle || id).padEnd(26)} ${String(h.rotulo).padEnd(38)} ${String(nicho).slice(0, 28)}`);
  }
  console.log("");
}
