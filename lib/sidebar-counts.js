// Cache apenas dos números globais do menu, nunca da sessão ou da sidebar renderizada.
// O adapter de cache é o unstable_cache do Next no layout; as leituras do Supabase
// continuam no-store e só os resultados numéricos têm revalidação de 60 segundos.
//
// Só se contam os badges que a Sidebar mostra — `prospects` (Descobertas) e `briefings`
// (Análise de dados), ambos só de admin (feedback rodada 2, B3.2 — set/2026). As contagens
// de creators, squads e campanhas deixaram de aparecer no menu e continuavam a correr a
// cada navegação; a de campanhas nem tinha cache (depende do dono e da partilha).
export function createSidebarCountLoader({ db, cache, cacheKey }) {
  const exactCount = async (query) => {
    const { count, error } = await query;
    // Não guardar um zero falso no cache durante uma falha do banco.
    if (error || !Number.isInteger(count) || count < 0) throw new Error("Contagem da sidebar indisponível");
    return count;
  };

  const globalCount = cache(async (table) => {
    // prospects não tem id; a chave é tubular_id. A contagem segue o filtro das
    // Descobertas, excluindo os irrecuperáveis (docs/handles-irrecuperaveis.md).
    let query = db.from(table).select(table === "prospects" ? "tubular_id" : "id", { count: "exact", head: true });
    if (table === "prospects") query = query.not("status", "like", "sem_handle:irrecuperavel%");
    return exactCount(query);
  }, ["sidebar-global-counts-v1", cacheKey], { revalidate: 60 });

  // Falha de um badge não impede a navegação nem apaga as outras contagens.
  // null oculta o badge; zero continua a significar uma contagem confirmada.
  const available = (promise) => promise.catch(() => null);

  /**
   * Contagens dos badges de admin. Pode arrancar ANTES de se saber o papel (em paralelo
   * com sessionRole): são números globais em cache de 60 s, e o layout só os entrega à
   * Sidebar quando o papel é admin — um operador nunca os recebe.
   */
  return async function sidebarCounts() {
    const [prospects, briefings] = await Promise.all([
      available(globalCount("prospects")),
      available(globalCount("briefings")),
    ]);
    return { prospects, briefings };
  };
}
