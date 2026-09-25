import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";

// O Next.js cacheia fetches GET no Data Cache da Vercel — pra leituras do
// Supabase isso serve dado VELHO entre invocações. Forçamos no-store sempre.
const freshFetch = (input, init = {}) => fetch(input, { ...init, cache: "no-store" });

// Este módulo já não exporta cliente anon. Exportava, e era ele que as páginas
// usavam para ler — o que só funcionava porque cada tabela tinha uma política
// `SELECT USING (true)` para o role `public`. Com o RLS fechado, ler com anon sem
// sessão devolve zero linhas em silêncio, que é a pior falha possível num
// dashboard. Quem precisa de anon no browser usa supabaseBrowser() de lib/auth.js,
// que carrega a sessão do utilizador.

// Cliente de escrita (pipeline — só no servidor)
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");
  return createClient(url, key, { global: { fetch: freshFetch } });
}

// Cliente de LEITURA do servidor (server components e route handlers).
//
// Antes as páginas liam com a chave anon, o que só funcionava porque cada tabela
// tinha uma política `SELECT USING (true)` para o role `public` — ou seja, a base
// inteira (incluindo o `crm`, com WhatsApp e e-mail) era descarregável por
// qualquer pessoa com a chave anon, que está publicada no bundle e no repositório.
// Fechadas essas políticas, quem lê no servidor precisa de service-role. É
// legítimo: estas leituras correm atrás do gate de sessão do middleware.
//
// É um Proxy e não uma função para o call site continuar `supabase.from(...)`
// (são 66 pela app) e para nada ser instanciado no import — assim um ambiente sem
// SUPABASE_SERVICE_ROLE_KEY só falha se realmente for ler, e com uma mensagem que
// diz o que falta em vez de devolver silenciosamente zero linhas.
let _server = null;
function serverClient() {
  if (_server) return _server;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada — necessária para as leituras do servidor desde que o RLS deixou de permitir leitura pública"
    );
  }
  _server = createClient(url, key, { global: { fetch: freshFetch } });
  return _server;
}
export const supabaseServer = new Proxy(
  {},
  {
    get: (_, prop) => {
      const c = serverClient();
      const v = c[prop];
      return typeof v === "function" ? v.bind(c) : v;
    },
  }
);
