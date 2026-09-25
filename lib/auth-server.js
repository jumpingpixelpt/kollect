// Sessão no SERVIDOR (server components e route handlers) + papel do utilizador.
// O middleware protege páginas e APIs; o papel (admin | operador, tabela user_roles)
// é verificado aqui quando a página/rota precisa dele.
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON } from "./auth";
import { supabaseAdmin } from "./supabase";
import { createSessionReaders } from "./session-data";

// React.cache só deduplica a renderização RSC do MESMO pedido. Não é cache global:
// cookies, mudanças de papel e partilhas são verificados novamente no pedido seguinte.
async function readUser() {
  const store = await cookies();
  const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    // só leitura de cookies: refresh de sessão é trabalho do middleware
    cookies: { getAll: () => store.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await sb.auth.getUser();
  return user ?? null;
}

export const { sessionUser, sessionRole } = createSessionReaders({
  cache,
  readUser,
  async readRole(userId) {
    const { data } = await supabaseAdmin().from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    return data?.role;
  },
});

/**
 * Briefings são individuais: cada utilizador vê os seus (decisão do cliente, set/2026).
 *
 * NULL é o regime LEGADO, não "de ninguém": as campanhas anteriores à coluna `user_id`
 * — incluindo os dois briefings fixos do cliente, em uso — nasceram num tempo em que a
 * plataforma era operada só pela casa e toda a gente via tudo. Escondê-las de todos
 * seria pior do que mantê-las comuns, por isso continuam visíveis a quem entra.
 *
 * O ADMIN vê todos (decisão do cliente, set/2026): quatro dos cinco utilizadores são a
 * casa, e quem opera a plataforma precisa de ver o trabalho que lá corre — para apoiar,
 * despistar e retomar o que ficou a meio. "Individuais" separa a vista de quem usa, não
 * fecha a porta a quem mantém.
 *
 * PARTILHA (pedido de 03/09/2026): o dono pode partilhar um briefing com colegas —
 * `campaigns.shared_with` (uuid[]) guarda com quem. Quem consta lá vê o briefing como se
 * fosse seu em todo o lado onde esta função filtra (lista, home, badge do menu, filtro por
 * briefing, ficha do creator). Partilhar não transfere a posse: apagar e gerir a partilha
 * continuam a ser do dono ou do admin (ver mandaNaCampanha).
 *
 * Aplica-se a uma query do PostgREST já começada:
 *   soMeus(supabase.from("campaigns").select("id, name"), user?.id, role === "admin")
 */
export function soMeus(q, userId, isAdmin = false) {
  if (isAdmin) return q;
  // cs = "contains" do PostgREST sobre o array; {uuid} é o literal de array do Postgres
  return userId ? q.or(`user_id.eq.${userId},user_id.is.null,shared_with.cs.{${userId}}`) : q.is("user_id", null);
}

/** A regra do soMeus para uma linha já carregada (ficha do creator, detalhe do briefing). */
export function veCampanha(camp, userId, isAdmin = false) {
  if (!camp) return false;
  if (isAdmin || camp.user_id == null) return true;
  if (!userId) return false;
  return camp.user_id === userId || (Array.isArray(camp.shared_with) && camp.shared_with.includes(userId));
}

/**
 * Quem manda no briefing — apagar, partilhar: o dono ou o admin. Um convidado vê, não
 * gere. No regime legado (sem dono) fica como sempre foi: qualquer utilizador.
 */
export function mandaNaCampanha(camp, userId, isAdmin = false) {
  if (!camp) return false;
  if (isAdmin || camp.user_id == null) return true;
  return !!userId && camp.user_id === userId;
}
