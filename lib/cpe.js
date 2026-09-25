/**
 * CPE comparativo — o mesmo CPE pode ser barato num nicho e caro noutro.
 * Compara o creator com a mediana da faixa de tamanho e a mediana do nicho.
 */

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function sizeRange(followers) {
  if (followers < 50000) return { key: "micro", label: "até 50k" };
  if (followers < 250000) return { key: "mid", label: "50k–250k" };
  return { key: "macro", label: "250k+" };
}

export function avgEngagementsByCreator(videos) {
  const acc = {};
  for (const v of videos || []) {
    // só vídeos com engajamento medido — views-only (Tubular v3) não dilui a média
    if (v.likes == null && v.comments == null && v.shares == null && v.saves == null) continue;
    (acc[v.creator_id] ||= []).push((v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0));
  }
  const out = {};
  for (const [id, arr] of Object.entries(acc)) out[id] = arr.reduce((a, b) => a + b, 0) / arr.length;
  return out;
}

/**
 * creators: linhas do leaderboard · engMap: avgEngagementsByCreator
 * Retorna benchmarks pro creator alvo: mediana de CPE da faixa e do nicho (excluindo ele).
 */
export function cpeBenchmarks(target, creators, engMap) {
  const cpeOf = (c) => {
    const eng = engMap[c.id];
    return c.cache_per_video && eng ? Number(c.cache_per_video) / eng : null;
  };
  const range = sizeRange(target.followers);
  const peers = creators.filter((c) => c.id !== target.id && cpeOf(c) != null);
  const sizePeers = peers.filter((c) => sizeRange(c.followers).key === range.key);
  const nichePeers = peers.filter((c) => c.category === target.category);
  return {
    sizeLabel: range.label,
    sizeMedian: median(sizePeers.map(cpeOf)),
    sizeCount: sizePeers.length,
    nicheLabel: target.category,
    nicheMedian: median(nichePeers.map(cpeOf)),
    nicheCount: nichePeers.length,
  };
}
