// Só números globais e opções públicas dentro da aplicação autenticada. Não
// incluir usuários, campanhas, sessões ou dados dependentes de partilha no cache.
export function createPainelLoader({ db, cache, cacheKey }) {
  return cache(async (hoje) => {
    const { data, error } = await db.rpc("painel_resumo", { p_hoje: hoje });
    const termometro = data?.termometro;
    const funil = data?.funil;
    const countOk = (n) => Number.isInteger(n) && n >= 0;
    if (error || !termometro || !funil ||
      !["universo", "qualificadas", "comGrowth", "noRadar"].every((k) => countOk(termometro[k])) ||
      !["universo", "comAnalise", "deHoje", "noFunil"].every((k) => countOk(funil[k])) ||
      !termometro.classes || typeof termometro.classes !== "object" || Array.isArray(termometro.classes) ||
      !Object.values(termometro.classes).every(countOk) ||
      !Array.isArray(termometro.fontes) || !Array.isArray(data.termos)) {
      throw new Error("Não foi possível carregar o resumo do funil");
    }
    return data;
  }, ["painel-resumo-v1", cacheKey], { revalidate: 60 });
}
