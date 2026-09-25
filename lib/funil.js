/**
 * Contagens do funil que a faixa FunilStats mostra em /descobertas e em /creators.
 *
 * Um sítio só para as três queries, para as duas páginas dizerem o mesmo número:
 *   universo   — prospects monitorados, sem os irrecuperáveis (o @ não se resolve, o cartão
 *                não é acionável — a mesma régua da lista de /descobertas);
 *   comAnalise — creators na base. "Com Análise Profunda" é quem passou pela cadeia de
 *                enriquecimento, e isso é a tabela creators inteira — inclui quem entrou por
 *                "Avaliar perfil" sem nunca ter sido prospect. Contar só os prospects com
 *                status "promovido" (o número antigo) deixava esses de fora e não batia com a
 *                lista nem com o badge da sidebar;
 *   deHoje     — prospects descobertos hoje e ainda por promover (o que a corrida trouxe).
 *
 * "Hoje" é o dia UTC do servidor, como sempre foi nesta página (diaISO).
 *
 *   noFunil    — prospects ainda no funil: a régua da lista de /descobertas sem filtro nenhum
 *                (sem promovidos, sem substituídos pelo IC, sem irrecuperáveis). É o "No filtro
 *                atual" que /creators mostra, para a faixa ser IGUAL nas duas páginas (pedido do
 *                utilizador, 03/09/2026) — em /creators a contagem do recorte da lista já está
 *                na barra da própria lista ("Mostrando 48 de 2.095"). Em /descobertas o quarto
 *                número continua a ser o da pesquisa da página, que sem filtros é este mesmo.
 */
export async function contagensFunil(supabase) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [{ count: universo }, { count: comAnalise }, { count: deHoje }, { count: noFunil }] = await Promise.all([
    supabase.from("prospects").select("tubular_id", { count: "exact", head: true })
      .not("status", "like", "sem_handle:irrecuperavel%"),
    supabase.from("creators").select("id", { count: "exact", head: true }),
    supabase.from("prospects").select("tubular_id", { count: "exact", head: true })
      .gte("descoberto_em", hoje).neq("status", "substituida_ic").neq("status", "promovido")
      .not("status", "like", "sem_handle:irrecuperavel%"),
    supabase.from("prospects").select("tubular_id", { count: "exact", head: true })
      .neq("status", "substituida_ic").neq("status", "promovido")
      .not("status", "like", "sem_handle:irrecuperavel%"),
  ]);
  return { universo: universo ?? 0, comAnalise: comAnalise ?? 0, deHoje: deHoje ?? 0, noFunil: noFunil ?? 0 };
}
