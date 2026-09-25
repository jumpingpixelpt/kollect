import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Verificação própria da rota — redundante com o middleware, de propósito.
 *
 * Desde bdcd648 o middleware fecha /api e aceita duas credenciais: sessão em cookie ou
 * Authorization: Bearer CRON_SECRET. Chegar aqui já implica ter passado por lá. Estas
 * rotas guardam a mesma verificação por defesa em profundidade: uma queima créditos de
 * Apify a cada chamada, a outra reescreve o ranking da base inteira, e o dia em que o
 * matcher do middleware ganhar uma exclusão não devem ficar a descoberto.
 *
 * O que muda face à versão anterior: elas aceitavam SÓ o bearer. Como o operador na app
 * não o tem — traz cookie de sessão —, abrir /api/cron/collect no browser, autenticado,
 * respondia {"error":"unauthorized"}. Não havia forma de disparar a coleta ou um rescore
 * à mão; era esperar pelo cron das 06:00. Passam a aceitar as mesmas duas credenciais do
 * middleware, em vez de metade delas.
 *
 * O cliente é criado com a chave ANON e um setAll vazio: só se quer ler a sessão do
 * pedido, nunca escrever cookies nem tocar em dados com privilégio.
 */
export async function autorizado(req) {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
    });
    const { data: { user } } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

export const NAO_AUTORIZADO = {
  error: "não autorizado",
  detalhe: "requer sessão iniciada ou Authorization: Bearer CRON_SECRET",
};

/**
 * Rotas da área de Gestão — só admins (decisão do cliente, ago/2026, reafirmada em set/2026:
 * "só o perfil de admin é que tem acesso à área de admin"). O bearer do CRON_SECRET continua
 * a passar: crons e orquestradores são o sistema, não um utilizador.
 *
 * As páginas de Gestão (Descobertas, Análise de dados, Utilizadores) já redirecionam quem não
 * é admin, e o menu não as mostra. Mas as ACÇÕES delas — correr a descoberta, promover em
 * lote, apagar prospects, criar análises — eram rotas que aceitavam qualquer sessão: o menu
 * escondia a porta, a fechadura não existia. O papel vem de user_roles, como em
 * lib/auth-server.js; quem não tem linha lá é operador.
 */
export async function autorizadoAdmin(req) {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabaseAdmin().from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
}

export const SO_ADMIN = {
  error: "não autorizado",
  detalhe: "rota da área de Gestão: requer sessão de admin ou Authorization: Bearer CRON_SECRET",
};

/**
 * Verificação própria de rota, em uma linha (pentest set/2026, "Improper Access Control":
 * 40 rotas confiavam só no middleware). Devolve null quando o pedido passa; senão a resposta
 * 401/403 pronta a devolver. `admin: true` exige o papel de admin (área de Gestão).
 *
 *   const bloqueio = await exigirSessao(req);            if (bloqueio) return bloqueio;
 *   const bloqueio = await exigirSessao(req, { admin: true });
 */
export async function exigirSessao(req, { admin = false } = {}) {
  const { NextResponse } = await import("next/server");
  if (admin) return (await autorizadoAdmin(req)) ? null : NextResponse.json(SO_ADMIN, { status: 403 });
  return (await autorizado(req)) ? null : NextResponse.json(NAO_AUTORIZADO, { status: 401 });
}
