import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/auth";
import { novoNonce, cspComNonce } from "@/lib/csp";

// Gate de login de TODA a app, páginas e /api.
//
// Até aqui /api ficava fora do matcher porque os crons da Vercel e as
// auto-chamadas dos orquestradores não têm cookie de sessão — cada rota teria de
// se proteger a si própria, e na prática 5 de 51 faziam-no. Ficavam 39 rotas de
// escrita com service-role abertas ao mundo (campaign-delete, promote-*,
// deep-scan, sweep...), umas destrutivas, outras a queimar crédito de
// Apify/Gemini/Tubular a cada pedido.
//
// Agora a proteção é estrutural: /api entra no matcher e aceita duas credenciais
// — sessão em cookie (operador na app, incluindo as imagens de /api/thumb, que o
// browser pede same-origin com cookie) ou Authorization: Bearer CRON_SECRET
// (crons e chamadas internas; lib/internal-fetch.js injeta-o em todas). Uma rota
// nova nasce fechada, em vez de nascer aberta.
//
// Sem CRON_SECRET configurada só passa a sessão: o padrão anterior
// (`if (process.env.CRON_SECRET && ...)`) não verificava nada quando a variável
// faltava — falhava ABERTO. Este falha fechado e diz porquê no corpo.
function mesmaOrigem(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  if (origin) { try { return new URL(origin).host === req.nextUrl.host; } catch { return false; } }
  // sem Sec-Fetch-Site nem Origin: navegação directa ou cliente sem browser; para pedidos
  // de escrita exige-se pelo menos o Referer da própria origem
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const ref = req.headers.get("referer");
  if (!ref) return false;
  try { return new URL(ref).host === req.nextUrl.host; } catch { return false; }
}

export async function middleware(req) {
  const api = req.nextUrl.pathname.startsWith("/api");
  const cron = process.env.CRON_SECRET;

  // CSP com nonce por pedido (ver lib/csp.js): vai no header do PEDIDO, para o Next e o layout o
  // lerem ao renderizar, e no header da RESPOSTA, para o browser o aplicar.
  const nonce = novoNonce();
  const csp = cspComNonce(nonce);
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", csp);
  const seguir = () => {
    const r = NextResponse.next({ request: { headers: reqHeaders } });
    r.headers.set("Content-Security-Policy", csp);
    return r;
  };

  if (api && cron && req.headers.get("authorization") === `Bearer ${cron}`) {
    return seguir();
  }

  let res = seguir();

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => req.cookies.set(name, value));
        // o pedido que segue leva os cookies renovados
        reqHeaders.set("cookie", req.headers.get("cookie") || "");
        res = seguir();
        cookies.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  // /api nunca redireciona: quem chama espera JSON, não o HTML do login.
  if (api) {
    if (user) {
      // CSRF (pentest set/2026): a sessão vai em cookie, e o browser junta-o a qualquer pedido —
      // uma página alheia podia disparar POST /api/campaign-delete ou um GET que gasta crédito
      // (/api/enrich) em nome do operador com sessão aberta. Os pedidos legítimos da app são
      // sempre same-origin: fetch() dos componentes, <img> do /api/thumb, a barra de endereço.
      // Sec-Fetch-Site é posto pelo browser e não pode ser forjado; Origin cobre os que não o
      // mandam. O bearer do CRON_SECRET não passa por aqui (já saiu acima) — crons e chamadas
      // internas não têm cookie, logo não têm CSRF.
      if (!mesmaOrigem(req)) {
        return NextResponse.json({ error: "pedido recusado", detalhe: "pedidos a /api com sessão têm de vir da própria origem (CSRF)" }, { status: 403 });
      }
      return res;
    }
    return NextResponse.json(
      {
        error: "não autorizado",
        detalhe: cron
          ? "requer sessão iniciada ou Authorization: Bearer CRON_SECRET"
          : "CRON_SECRET não configurada — pedidos sem sessão não têm como ser autenticados",
      },
      { status: 401 }
    );
  }

  const noLogin = req.nextUrl.pathname === "/login";
  // /recuperar é pública nos dois sentidos: quem chega pelo link ainda não tem sessão (a
  // página troca o token por uma), e quem já tem sessão pode estar a definir a password.
  const publica = noLogin || req.nextUrl.pathname === "/recuperar";
  if (!user && !publica) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && noLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml)$).*)"],
};
