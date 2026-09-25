// A leitura é uma RPC escalar: o limite de 1000 linhas do PostgREST não corta os
// arrays, e leaderboard/séries são calculadas uma vez por montagem, não por página.
// Só o service_role pode executar a função; o acesso do utilizador continua no gate
// da app. O fetch do cliente Supabase permanece no-store.
export async function fetchRadarSource(db, light = false) {
  const { data, error } = await db.rpc("radar_base", { p_light: light });
  if (error) throw new Error(`Falha ao carregar creators: ${error.message || "consulta indisponível"}`);
  if (!data || !["creators", "bhRows", "seriesRows", "vstats"].every((key) => Array.isArray(data[key]))) {
    throw new Error("Falha ao carregar creators: resposta incompleta da base");
  }
  return data;
}
