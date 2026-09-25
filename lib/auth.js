// Auth por Supabase (sessão em cookie via @supabase/ssr).
// O middleware protege as páginas; este módulo dá o cliente de browser
// para login/logout e partilha as constantes públicas com o middleware.
import { createBrowserClient } from "@supabase/ssr";

// As duas vêm SÓ do ambiente (pentest set/2026: a chave anon estava escrita aqui como
// fallback — é pública por desenho, mas um JWT no repositório é achado em qualquer auditoria e
// prende o código a um projeto Supabase). next.config.mjs falha o BUILD se faltarem, para o
// erro aparecer na Vercel e não em produção a meio de um pedido. Local: .env.local.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function supabaseBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
}
