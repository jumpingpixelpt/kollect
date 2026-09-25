/**
 * RADAR SCORE — score proprietário de rising stars (0–100)
 *
 * Desenhado pra capturar influência ANTES da escala (o "fator Cazé"):
 * quem já move audiência enquanto o cachê ainda é barato.
 *
 *  1. MOMENTUM (35 pts)  — velocidade + aceleração de crescimento
 *  2. GRAVIDADE (30 pts) — qualidade do engajamento relativa ao tamanho
 *  3. AUTORIDADE (25 pts)— análise do conteúdo transcrito (Groq + Claude)
 *  4. JANELA DE CACHÊ (10 pts) — bônus pra base pequena com pilares altos
 */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 1. Momentum: crescimento semanal de seguidores + crescimento de views
export function momentum(snapshots) {
  if (snapshots.length < 2) return 0;
  const s = [...snapshots].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
  const weeks = (new Date(s.at(-1).captured_at) - new Date(s[0].captured_at)) / 6048e5 || 1;
  const fGrowth = (s.at(-1).followers / s[0].followers - 1) / weeks;        // %/semana
  const vGrowth = s[0].avg_views ? (s.at(-1).avg_views / s[0].avg_views - 1) / weeks : 0;
  // aceleração: segunda metade cresce mais que a primeira?
  const mid = s[Math.floor(s.length / 2)];
  const acc = mid.followers > s[0].followers
    ? (s.at(-1).followers / mid.followers) / (mid.followers / s[0].followers) - 1
    : 0;
  const raw = fGrowth * 180 + vGrowth * 100 + clamp(acc, 0, 0.5) * 30;
  return clamp(raw, 0, 35);
}

// 2. Tração de Audiência: engajamento + alcance por seguidor + performance de publi
export function tracao(latest, followers, brandHistory) {
  if (!latest) return 0;
  const er = Number(latest.eng_rate) || 0;
  const saves = Number(latest.saves_per_1k) || 0;
  const shares = Number(latest.shares_per_1k) || 0;
  const engPart = clamp(er * 1.2 + saves * 0.2 + shares * 0.3, 0, 15);
  // alcance: views médias por seguidor (viralização além da base)
  const reach = followers > 0 && latest.avg_views
    ? clamp((latest.avg_views / followers) * 1.5, 0, 10) : 0;
  // publi que segura engajamento vale mais
  const ratio = brandHistory?.brand_engagement?.ratio;
  const bePart = ratio == null ? 0 : ratio >= 1.1 ? 5 : ratio >= 0.85 ? 3 : 0;
  return clamp(engPart + reach + bePart, 0, 30);
}

// 3. Autoridade & Foco: análise de conteúdo por IA + concentração de nicho
export function autoridade(videos, brandHistory) {
  const scored = videos.filter((v) => v.content_score != null);
  const avg = scored.length ? scored.reduce((a, v) => a + Number(v.content_score), 0) / scored.length : 0;
  const contentPart = clamp(avg * 2, 0, 20);
  const nichos = brandHistory?.nichos;
  const topPct = nichos?.length ? Math.max(...nichos.map((n) => Number(n.pct) || 0)) : null;
  const foco = topPct == null ? 0 : topPct >= 60 ? 5 : topPct >= 40 ? 3 : 1;
  return clamp(contentPart + foco, 0, 25);
}

// 4. Janela de Cachê: bônus inverso ao tamanho, condicionado a pilares fortes
export function janelaDeCache(followers, pilares) {
  if (pilares < 55) return 0;
  if (followers >= 500000) return 0;
  if (followers >= 250000) return 2;
  if (followers >= 100000) return 5;
  if (followers >= 30000) return 8;
  return 10;
}

export function radarScore({ snapshots, videos, followers, brandHistory }) {
  const m = momentum(snapshots) * (30 / 35); // momentum reescalonado pra 30
  const g = tracao(snapshots.at(-1), followers, brandHistory);
  const a = autoridade(videos, brandHistory);
  const w = janelaDeCache(followers, m + g + a);
  const total = Math.round((m + g + a + w) * 10) / 10;
  return {
    momentum: Math.round(m * 10) / 10,
    gravity: Math.round(g * 10) / 10,
    authority: Math.round(a * 10) / 10,
    window_bonus: w,
    total,
    janela_aberta: total >= 75 && followers < 100000,
  };
}

// Mini-score do FUNIL (fonte-agnóstico, IC-nativo): qualifica o universo.
// Engajamento (×3, teto 30) + tamanho (10–300k=30, 3–10k=18, resto=8) + crescimento (growthPct ×8, teto 40; null=0).
// growthPct é o % de crescimento mensal medido por nós (delta de seguidores entre sweeps); null = ainda sem leitura.
export function funnelMiniScore({ engPct, followers, growthPct }) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const eng = clamp((Number(engPct) || 0) * 3, 0, 30);
  const f = Number(followers) || 0;
  const size = f >= 10000 && f <= 300000 ? 30 : f >= 3000 && f < 10000 ? 18 : 8;
  const growth = growthPct == null ? 0 : clamp(Number(growthPct) * 8, 0, 40);
  return Math.round((eng + size + growth) * 10) / 10;
}
