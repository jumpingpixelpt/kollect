/** @type {import('next').NextConfig} */

// Cabeçalhos de segurança (pentest de set/2026: "CSP header not set", "Missing
// Anti-clickjacking header", "Sub Resource Integrity Attribute Missing").
//
// A app não é embebível — frame-ancestors 'none' + X-Frame-Options DENY. As fontes deixaram
// de vir do Google Fonts em runtime (next/font serve-as do próprio domínio), por isso a CSP
// não precisa de fonts.googleapis.com e o achado de SRI desaparece com a <link> externa.
//
// A CSP vive no middleware (nonce por pedido, lib/csp.js); aqui ficam os cabeçalhos fixos.
//
// Referrer-Policy: no-referrer — o link de recuperação de password traz o token no URL
// (/recuperar?token_hash=…); sem referrer, o token nunca sai para outra origem.
// Sem estas duas o middleware não consegue ler sessões: falha aqui, no build, e não em produção.
for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  if (!process.env[v]) throw new Error(`${v} em falta no ambiente de build (define-a na Vercel e em .env.local)`);
}

// A Content-Security-Policy é gerada por pedido no middleware, com nonce — ver lib/csp.js.

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // unpdf (extração de texto dos PDFs de briefing) traz o pdf.js: fica fora do bundle do
  // servidor e é carregado como pacote Node em runtime, senão o webpack parte o worker.
  serverExternalPackages: ["unpdf"],
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};
export default nextConfig;
