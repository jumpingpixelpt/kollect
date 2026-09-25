// Monta o objeto de audiência (demografia + popularidade + afinidade) a partir do
// audience_followers do influencers.club. v:2 marca registros já com os campos novos.
export function buildAudience(aud) {
  if (!aud) return null;
  const d = aud.data || aud; // o IC envolve em { success, data:{...} }
  const pc = (x) => (x != null && Number.isFinite(+x)) ? Math.round(x * 1000) / 10 : null;
  const fem = (d.audience_genders ?? []).find((g) => g.code === "FEMALE")?.weight ?? null;
  const faixa = (d.audience_ages ?? []).filter((a) => ["18-24", "25-34", "35-44"].includes(a.code)).reduce((s, a) => s + (a.weight || 0), 0);
  const br = (d.audience_geo?.countries ?? []).find((c) => c.code === "BR")?.weight ?? null;
  return {
    fonte: "influencers_club", coletado_em: new Date().toISOString().slice(0, 10), v: 2,
    mulheres_pct: pc(fem), faixa_18_45_pct: pc(faixa), brasil_pct: pc(br),
    notaveis_pct: pc(d.notable_users_ratio),
    credibilidade_pct: pc(d.audience_credibility),
    marcas_afinidade: (d.audience_brand_affinity ?? []).slice(0, 10).map((b) => b.name).filter(Boolean),
    interesses: (d.audience_interests ?? []).slice(0, 6).map((i) => i.name).filter(Boolean),
    idades: d.audience_ages ?? null, generos: d.audience_genders ?? null,
  };
}
