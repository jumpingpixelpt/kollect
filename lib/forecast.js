/**
 * TRAÇÃO, CLASSIFICAÇÃO E FORECAST
 *
 * Curva de Tração: combina crescimento de seguidores e de engajamento numa série só.
 *   T(t) = 100 × (F_t / F_0)^0.6 × (E_t / E_0)^0.4
 *   Seguidor pesa 60%, engajamento 40%. Se a base cresce mas o engajamento despenca
 *   (perfil que viralizou e não reteve), a curva de tração denuncia — ela achata
 *   ou cai mesmo com seguidores subindo.
 *
 * Classificação (Momento vs. Cultura):
 *   RISING STAR  — cresce E sustenta: ≥70% das semanas com crescimento real e ritmo recente vivo
 *   MOMENTO CULTURAL — spike de views ≥2.5× a mediana + ritmo recente desabou vs. o pico
 *   EM OBSERVAÇÃO — nenhum dos dois com confiança
 *
 * Forecast 30 dias:
 *   ritmo recente de seguidores ajustado pela tendência de engajamento
 *   (engajamento caindo desconta o ritmo; subindo, amplifica) → projeção e veredito.
 */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sortByDate = (s) => [...s].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function weeklyGrowths(snaps) {
  const s = sortByDate(snaps);
  const g = [];
  for (let i = 1; i < s.length; i++) g.push(s[i].followers / s[i - 1].followers - 1);
  return g;
}

export function tractionSeries(snaps) {
  const s = sortByDate(snaps);
  if (!s.length) return [];
  const F0 = s[0].followers || 1;
  const E0 = Number(s[0].eng_rate) || 1;
  return s.map((x) =>
    Math.round(100 * Math.pow(x.followers / F0, 0.6) * Math.pow((Number(x.eng_rate) || E0) / E0, 0.4) * 10) / 10
  );
}

export function classify(snaps) {
  if (!snaps || snaps.length < 4) return "observacao";
  const s = sortByDate(snaps);
  const views = s.map((x) => x.avg_views || 0).filter(Boolean);
  const spike = views.length ? Math.max(...views) / (median(views) || 1) : 1;
  const g = weeklyGrowths(s);
  const gMax = Math.max(...g);
  const gLast = mean(g.slice(-2));
  const sustain = g.filter((x) => x >= 0.015).length / g.length;
  if (spike >= 2.5 && gLast < 0.35 * gMax) return "momento";
  if (sustain >= 0.7 && gLast >= 0.025) return "rising";
  return "observacao";
}

export function forecast(snaps) {
  if (!snaps || snaps.length < 4) return null;
  const s = sortByDate(snaps);

  // pontos (dias, ln(seguidores)) — normalizado por tempo real entre snapshots,
  // então funciona com série diária, semanal ou mensal sem distorção
  const t0 = new Date(s[0].captured_at).getTime();
  const pts = s.map((x) => ({ d: (new Date(x.captured_at).getTime() - t0) / 864e5, y: Math.log(x.followers || 1) }));

  // janela recente: últimos ~120 dias (mínimo 4 pontos)
  const dMax = pts.at(-1).d;
  let recent = pts.filter((p) => dMax - p.d <= 120);
  if (recent.length < 4) recent = pts.slice(-4);

  // regressão linear ponderada por recência sobre ln(F)
  const w = recent.map((p) => 1 + (p.d - recent[0].d) / Math.max(1, dMax - recent[0].d));
  const sw = w.reduce((a, b) => a + b, 0);
  const mx = recent.reduce((a, p, i) => a + w[i] * p.d, 0) / sw;
  const my = recent.reduce((a, p, i) => a + w[i] * p.y, 0) / sw;
  let num = 0, den = 0;
  recent.forEach((p, i) => { num += w[i] * (p.d - mx) * (p.y - my); den += w[i] * (p.d - mx) ** 2; });
  let dailyRate = den ? num / den : 0;                       // crescimento diário (log)
  dailyRate = clamp(dailyRate, -0.03, 0.03);                 // trava de outlier: ±3%/dia

  // R² do ajuste → confiança
  const ssTot = recent.reduce((a, p, i) => a + w[i] * (p.y - my) ** 2, 0);
  const ssRes = recent.reduce((a, p, i) => a + w[i] * (p.y - (my + dailyRate * (p.d - mx))) ** 2, 0);
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;

  // ajuste por tendência de engajamento (caindo desconta, subindo amplifica)
  const er = s.map((x) => Number(x.eng_rate) || 0).filter(Boolean);
  const erFirst = mean(er.slice(0, 3)) || 0;
  const erLast = mean(er.slice(-3));
  const engTrend = erFirst ? erLast / erFirst - 1 : 0;
  const rAdj = dailyRate * (1 + clamp(engTrend, -0.35, 0.35) * Math.sign(dailyRate || 1));

  const F = s.at(-1).followers;
  const proj30 = Math.round(F * Math.exp(rAdj * 30));
  const delta30 = proj30 / F - 1;
  const direction = delta30 >= 0.08 ? "crescer" : delta30 <= -0.03 ? "cair" : "estavel";
  const confidence = r2 >= 0.8 && recent.length >= 5 ? "alta" : r2 >= 0.45 ? "média" : "baixa";

  return {
    direction, proj30, delta30: Math.round(delta30 * 1000) / 10,
    weeklyRate: Math.round(rAdj * 7 * 1000) / 10,
    engTrend: Math.round(engTrend * 1000) / 10,
    confidence,
  };
}

export const CLASS_LABEL = {
  rising: "Rising Star",
  momento: "Momento Viral",
  observacao: "Em observação",
};

export const FORECAST_LABEL = {
  crescer: "vai crescer",
  estavel: "vai estabilizar",
  cair: "vai cair",
};
