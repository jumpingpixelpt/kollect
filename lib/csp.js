// Content-Security-Policy com nonce por pedido (pentest set/2026: "CSP config allows inline
// javascript"). O middleware gera o nonce, mete-o no header do pedido (x-nonce) e no CSP da
// resposta; o App Router do Next lê o CSP do pedido e põe o nonce nos <script> que ele próprio
// emite (hidratação, chunks, e com 'strict-dynamic' também os que carrega depois). O único
// script inline nosso — o THEME_BOOT do layout — recebe o nonce via headers().
//
// Consequência: todas as páginas passam a ser renderizadas por pedido (o layout lê headers()).
// Já eram quase todas (force-dynamic / revalidate 0); as três com revalidate 30–60 apoiavam-se
// no cache de processo de lib/radar-data.js, que continua a valer.
//
// style-src mantém 'unsafe-inline': os componentes usam style={{…}} por todo o lado e o CSP
// bloqueia atributos style sem isso (é o achado "allows inline CSS", Low, aceite).
//
// Só corre no middleware (Edge/Node runtime): nada de imports do Node aqui.
export function novoNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function cspComNonce(nonce) {
  const supa = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host; } catch { return "*.supabase.co"; } })();
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // 'strict-dynamic': os scripts carregados por um script com nonce herdam a confiança;
    // em dev o React Refresh precisa de eval
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: https://${supa}`,
    `connect-src 'self' https://${supa} wss://${supa}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}
