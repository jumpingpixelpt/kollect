// Testes do motor Score KOL (lib/kolscore.js) — corre com: node test-kolscore.mjs
// Sai com código ≠0 se alguma asserção falhar.
import { kolScore, saturacaoConcorrentes, territorioPct, CONFIG } from "./lib/kolscore.js";

let falhas = 0;
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { falhas++; console.error(`  ✗ ${msg}`); } };
const HOJE = "2026-07-25";

const base = {
  followers: 85000,
  kol_screen: {
    metricas: { niche_bucket: "cabelo", niche_density: 85, eng_index: 1.4, reach_eff: 0.6, follower_pct: 0.41, consistency_pct: 55 },
    comercial: [
      { id: "sat", resultado: "baixa", detalhe: "2 marcas" },
      { id: "bets", resultado: "limpo", detalhe: "nenhuma" },
    ],
  },
  brand_history: {
    nichos: [{ nicho: "Cabelo", pct: 85 }, { nicho: "Lifestyle", pct: 15 }],
    marcas: [
      { marca: "Pantene Brasil", tipo: "publi", videos: 2, ultima: "2026-07-01", views_total: 100000 },
      { marca: "Zara", tipo: "publi", videos: 1, ultima: "2026-06-01" },
    ],
    brand_engagement: { ratio: 1.05 },
  },
  audience: { mulheres_pct: 89.1, faixa_18_45_pct: 91, brasil_pct: 98.7, notaveis_pct: 41.8, credibilidade_pct: 77.3, generos: [{ code: "FEMALE", weight: 0.891 }, { code: "MALE", weight: 0.109 }] },
  growth30_pct: 3,
};
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log("1. Creator elegível completo (feminino, beauty)");
{
  const r = kolScore(base, { hoje: HOJE });
  ok(r.elegivel === true, "é elegível");
  ok(r.cortes.length === 3 && r.cortes.every((c) => c.passou), "3 cortes, todos passam");
  ok(r.score != null && r.score > 50 && r.score <= 100, `score plausível (${r.score})`);
  ok(r.fatores.length === 5, "5 fatores");
  ok(r.fatores.every((f) => f.disponivel), "todos os fatores disponíveis");
  const somaPesos = r.fatores.reduce((s, f) => s + f.peso_norm, 0);
  ok(Math.abs(somaPesos - 100) < 0.5, `pesos normalizados somam ~100 (${somaPesos})`);
  ok(r.fatores.every((f) => f.razao && f.razao.length > 10), "todas as razões preenchidas");
  ok(r.saturacao.nivel !== "sem_dados", "saturação calculada");
  ok(r.saturacao.evidencias.some((e) => e.marca === "Pantene"), "Pantene detetada como concorrente");
  ok(!r.saturacao.evidencias.some((e) => /zara/i.test(e.marca)), "Zara (não-concorrente) ignorada");
}

console.log("2. Corte de território (<50%)");
{
  const d = clone(base);
  d.brand_history.nichos = [{ nicho: "Cabelo", pct: 30 }, { nicho: "Lifestyle", pct: 70 }];
  const r = kolScore(d, { hoje: HOJE });
  ok(r.elegivel === false, "inelegível");
  ok(r.score === null, "score null quando inelegível");
  ok(r.score_bruto != null, "score_bruto mantido para diagnóstico");
  const corte = r.cortes.find((c) => c.id === "territorio");
  ok(corte.passou === false && /30%/.test(corte.razao), `razão do corte explica o valor (${corte.razao})`);
  ok(r.classe === null, "sem classe quando inelegível");
}

console.log("3. Red flag BETs → inelegível");
{
  const d = clone(base);
  d.kol_screen.comercial = [{ id: "sat", resultado: "baixa" }, { id: "bets", resultado: "red flag", detalhe: 'menção detectada: "bet365"' }];
  const r = kolScore(d, { hoje: HOJE });
  ok(r.elegivel === false, "inelegível por brand safety");
  ok(/bet365|aposta/i.test(r.cortes.find((c) => c.id === "brand_safety").razao), "razão cita a evidência");
}

console.log("4. Sem audiência → renormaliza pesos, não inventa nota");
{
  const d = clone(base);
  d.audience = null;
  const r = kolScore(d, { hoje: HOJE });
  ok(r.elegivel === true, "continua elegível (cortes não dependem de audiência)");
  ok(r.fatores_indisponiveis.includes("autoridade") && r.fatores_indisponiveis.includes("aderencia"), "autoridade e aderência marcadas indisponíveis");
  const disp = r.fatores.filter((f) => f.disponivel);
  const somaPesos = disp.reduce((s, f) => s + f.peso_norm, 0);
  ok(Math.abs(somaPesos - 100) < 0.5, `pesos redistribuídos somam ~100 (${somaPesos})`);
  ok(r.fatores.find((f) => f.id === "autoridade").peso_norm === 0, "fator indisponível tem peso_norm 0");
  ok(r.score != null, "score calculado só com os fatores disponíveis");
}

console.log("5. Saturação NÃO desconta o score (camada separada — briefing §8.4)");
{
  const semSat = clone(base);
  semSat.brand_history.marcas = [];
  const comSat = clone(base);
  comSat.brand_history.marcas = [
    { marca: "Pantene", tipo: "publi", videos: 3, ultima: "2026-07-10" },
    { marca: "Dove Brasil", tipo: "publi", videos: 2, ultima: "2026-07-05" },
    { marca: "Salon Line", tipo: "afiliado", videos: 2, ultima: "2026-06-20" },
  ];
  const a = kolScore(semSat, { hoje: HOJE });
  const b = kolScore(comSat, { hoje: HOJE });
  ok(a.score === b.score, `score idêntico com e sem saturação (${a.score} = ${b.score})`);
  ok(b.saturacao.nivel === "alta", `nível alta com 3 concorrentes recentes (pontos=${b.saturacao.pontos})`);
  ok(b.saturacao.evidencias.length === 3, "3 evidências");
}

console.log("6. Saturação interna (L'Oréal) reportada à parte, sem pontuar");
{
  const d = clone(base);
  d.brand_history.marcas = [{ marca: "L'Oréal Paris Elseve", tipo: "publi", videos: 2, ultima: "2026-07-01" }];
  const r = kolScore(d, { hoje: HOJE });
  ok(r.saturacao.nivel === "nenhuma", "marcas L'Oréal não pontuam no nível");
  ok(r.saturacao.interna.length === 1 && /Elseve/.test(r.saturacao.interna[0].marca), "Elseve listada como interna");
}

console.log("7. Público masculino usa generos[]");
{
  const d = clone(base);
  d.audience.generos = [{ code: "FEMALE", weight: 0.25 }, { code: "MALE", weight: 0.75 }];
  d.audience.mulheres_pct = 25;
  const fem = kolScore(d, { hoje: HOJE, publico: "feminino" });
  const masc = kolScore(d, { hoje: HOJE, publico: "masculino" });
  const nF = fem.fatores.find((f) => f.id === "aderencia").nota;
  const nM = masc.fatores.find((f) => f.id === "aderencia").nota;
  ok(nM > nF, `audiência 75% masculina pontua mais no briefing masculino (${nM} > ${nF})`);
  ok(/75% homens/.test(masc.fatores.find((f) => f.id === "aderencia").razao), "razão cita % de homens");
}

console.log("8. Recência pesa na saturação");
{
  const rec = saturacaoConcorrentes({ marcas: [{ marca: "Pantene", tipo: "publi", videos: 1, ultima: "2026-07-20" }] }, { hoje: HOJE });
  const ant = saturacaoConcorrentes({ marcas: [{ marca: "Pantene", tipo: "publi", videos: 1, ultima: "2025-09-01" }] }, { hoje: HOJE });
  ok(rec.pontos > ant.pontos, `publi recente pontua mais (${rec.pontos} > ${ant.pontos})`);
}

console.log("9. territorioPct");
{
  ok(territorioPct([{ nicho: "Cabelo", pct: 60 }, { nicho: "Maquiagem", pct: 20 }, { nicho: "Lifestyle", pct: 20 }], "beauty") === 80, "beauty soma os territórios de beleza (80)");
  ok(territorioPct([{ nicho: "Cabelo", pct: 60 }, { nicho: "Maquiagem", pct: 20 }], "cabelo") === 60, "cabelo isola o bucket (60)");
  ok(territorioPct(null) === null, "sem nichos → null (não zero)");
}

console.log("10. Classes: rising e hidden atingíveis (calibração)");
{
  const rising = clone(base);
  rising.growth30_pct = 12; rising.followers = 60000;
  rising.kol_screen.metricas.niche_density = 70; rising.brand_history.nichos = [{ nicho: "Cabelo", pct: 70 }, { nicho: "Lifestyle", pct: 30 }];
  const r1x = kolScore(rising, { hoje: HOJE });
  ok(["rising_star", "kol"].includes(r1x.classe), `crescimento 12%/m → rising_star ou kol (${r1x.classe})`);

  const gem = clone(base);
  gem.growth30_pct = 1; gem.followers = 18000;
  gem.kol_screen.metricas.eng_index = 1.8; gem.kol_screen.metricas.follower_pct = 0.2;
  gem.audience.notaveis_pct = 30; gem.brand_history.marcas = [];
  const r2x = kolScore(gem, { hoje: HOJE });
  ok(["hidden_gem", "kol"].includes(r2x.classe), `eng 1.8× + base pequena + sem saturação → hidden_gem (${r2x.classe})`);
}

console.log("11. Dados de produção malformados não crasham (regressão da revisão adversarial)");
{
  const d1 = clone(base);
  d1.kol_screen.comercial = { sat: "baixa" }; // objeto em vez de array
  const r1x = kolScore(d1, { hoje: HOJE });
  ok(r1x.score != null || r1x.score_bruto != null, "comercial como objeto não crasha");

  const d2 = clone(base);
  d2.kol_screen.comercial = [null, { id: "bets", resultado: "limpo" }]; // entrada null
  ok(kolScore(d2, { hoje: HOJE }).elegivel === true, "entrada null no comercial não crasha");

  const d3 = clone(base);
  d3.audience.generos = [null, { code: "MALE" }]; // null + weight ausente
  const r3 = kolScore(d3, { hoje: HOJE, publico: "masculino" });
  ok(Number.isFinite(r3.score ?? r3.score_bruto), "generos com null/sem weight não produz NaN (fallback 100−mulheres)");
  ok(/10.9% homens/.test(r3.fatores.find((f) => f.id === "aderencia").razao), "fallback usa 100 − mulheres_pct");

  const d4 = clone(base);
  d4.kol_screen = null; d4.audience = null; d4.brand_history = null;
  const r4 = kolScore(d4, { hoje: HOJE });
  ok(r4.elegivel === false && r4.cortes.length === 3, "dossiê vazio → inelegível com cortes explicados, sem crash");

  const d5 = clone(base);
  d5.brand_history.marcas = [{ marca: "Pantene", tipo: "publi", videos: 1, ultima: "2027-01-01" }]; // data futura
  const r5 = kolScore(d5, { hoje: HOJE });
  ok(r5.saturacao.pontos >= 6, `data futura tratada como muito recente (pontos=${r5.saturacao.pontos})`);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTodos os testes passaram ✓");
process.exit(falhas ? 1 : 0);
