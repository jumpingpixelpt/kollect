const nonNegative = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/**
 * Projeção da squad: um post por creator, usando o último snapshot.
 *
 * Taxa ausente NÃO é 0%. Quem não tem taxa fica fora do numerador E do denominador
 * da E.R., mas continua contribuindo para as views conhecidas. A E.R. conjunta é
 * engajamentos projetados ÷ views do mesmo subconjunto, nunca média simples de taxas
 * nem engajamentos ÷ seguidores (decisão do cliente, jun/set/2026).
 *
 * A soma de seguidores continua sendo "alcance somado": contas diferentes podem
 * conter as mesmas pessoas, portanto esse número não mede audiência única.
 */
export function squadProjection(items = []) {
  let views = 0, eng = 0, engViews = 0, base = 0, erBase = 0;
  let alcance = 0, alcanceBase = 0;
  for (const item of items) {
    // Prospects sem análise não entram nas projeções de views ou engajamento.
    const metrics = item.creator_id ? item.metrics : null;
    const avgViews = nonNegative(metrics?.avg_views);
    const er = nonNegative(metrics?.eng_rate);
    if (avgViews != null) {
      views += avgViews;
      base++;
      if (avgViews > 0 && er != null) {
        eng += avgViews * er / 100;
        engViews += avgViews;
        erBase++;
      }
    }
    const profile = item.creator_id ? item.creator : item.prospect;
    const followers = nonNegative(profile?.followers);
    if (followers != null) {
      alcance += followers;
      alcanceBase++;
    }
  }
  return {
    views: base ? views : null,
    eng: erBase ? eng : null,
    base,
    total: items.length,
    er: engViews > 0 ? eng / engViews * 100 : null,
    erBase,
    alcance: alcanceBase ? alcance : null,
    alcanceBase,
  };
}
