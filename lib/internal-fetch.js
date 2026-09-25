// Chamadas internas entre rotas (a orquestração desta app é HTTP, não imports).
//
// Três problemas que este helper resolve:
//  1. Proteção de deployment (Vercel SSO) — nos previews, uma rota a chamar outra
//     no mesmo domínio vai sem cookie de sessão e leva 302 para a página de SSO.
//     O corpo deixa de ser JSON e o .json() rebenta. Se o projeto tiver o
//     "Protection Bypass for Automation" ligado, a Vercel injeta
//     VERCEL_AUTOMATION_BYPASS_SECRET e o header abaixo passa a barreira.
//  2. Autenticação — as rotas passaram a exigir sessão ou Bearer CRON_SECRET
//     (o gate está em middleware.js). Uma rota a chamar outra não tem cookie, por isso vai
//     com o segredo. É o único sítio onde este header se injeta: se uma chamada
//     interna não passar por aqui, leva 401.
//  3. Diagnóstico — em vez de "X sem resposta", devolve status e um excerto do
//     corpo, que é o que distingue "SSO bloqueou" de "a função rebentou".
//
// TODAS as chamadas internas GET têm de levar `cache: "no-store"`. O Next cacheia fetches
// GET no Data Cache da Vercel, e as URLs desta app são chaveadas por handle — ou seja,
// idênticas entre execuções. Sem no-store, a segunda passagem por
// /api/brand-scan?handle=x recebe a RESPOSTA GRAVADA da primeira: um 200 com o JSON de
// sucesso, sem a rota chegar a correr. O orquestrador conta o passo como "ok", nada é
// escrito na base e não há sequer um pedido nos logs. Foi o que aconteceu ao
// @principealeff em jul/2026 — a cadeia respondia "10 de 12 ok" com a base intacta,
// porque estava a reler o resultado de um creator que já não existia.
// (É a mesma armadilha que lib/supabase.js documenta para as leituras do Supabase.)
export function internalHeaders() {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const cron = process.env.CRON_SECRET;
  return {
    ...(bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "false" } : {}),
    ...(cron ? { authorization: `Bearer ${cron}` } : {}),
  };
}

/** GET numa rota irmã. Devolve o JSON dela, ou {error} explicando o que veio em vez disso. */
export async function internalJson(url, { timeout = 280000, nome = "rota interna" } = {}) {
  let r;
  try {
    r = await fetch(url, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    return { error: `${nome}: falha de rede/timeout`, detalhe: String(e).slice(0, 200) };
  }
  const txt = await r.text().catch(() => "");
  try {
    return JSON.parse(txt);
  } catch {
    const protegido = r.status === 302 || r.status === 401 || /vercel.com\/sso-api|Authentication Required/i.test(txt);
    return {
      error: protegido
        ? `${nome}: bloqueada pela proteção de deployment (HTTP ${r.status}) — ative o Protection Bypass for Automation na Vercel ou teste em produção`
        : `${nome}: resposta não-JSON (HTTP ${r.status})`,
      detalhe: txt.slice(0, 200),
    };
  }
}
