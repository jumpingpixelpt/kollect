// Erros que o cliente vê (feedback rodada 2, bug 1 — set/2026).
//
// O ecrã da Busca mostrou ao cliente o JSON cru da Anthropic ("Your credit balance is too
// low…"): as rotas faziam `{ error: String(e) }` e os componentes `setErr(j.error)`. A regra
// passa a ser: o erro completo vai para os logs (console.error, com um `ref` curto para
// cruzar), e a resposta leva só uma mensagem amigável + um código estável. A convenção de
// HTTP 200 com `{ error }` mantém-se (CLAUDE.md) — muda só o conteúdo.
//
// Uso numa rota:
//   catch (e) { return NextResponse.json(erroPublico(e, "briefing-parse"), { status: 200 }); }
// Um erro de provedor detectado sem exceção (ex.: `if (!res.ok)`) passa pelo mesmo sítio:
//   erroPublico(new ErroProvedor("anthropic", res.status, out), "brand-scan")

const MENSAGENS = {
  ia_indisponivel: "A análise inteligente está temporariamente indisponível. Nossa equipe já foi avisada — tente de novo daqui a alguns minutos.",
  limite: "Há muita demanda neste momento. Aguarde alguns segundos e tente de novo.",
  tempo: "A análise demorou mais do que o esperado. Tente de novo; se repetir, simplifique o pedido.",
  interno: "Não foi possível concluir agora. Tente de novo em alguns minutos.",
};

export class ErroProvedor extends Error {
  constructor(provedor, status, corpo) {
    super(`${provedor} ${status}: ${typeof corpo === "string" ? corpo : JSON.stringify(corpo)}`.slice(0, 600));
    this.provedor = provedor;
    this.status = status;
  }
}

// Classifica pelo texto e pelo status: créditos/billing/auth → ia_indisponivel (é nossa
// conta que está em baixo, não o pedido do cliente), 429/overloaded → limite, timeouts → tempo.
export function classificarErro(e) {
  const txt = String(e?.message || e || "").toLowerCase();
  const status = Number(e?.status) || 0;
  if (/credit balance|billing|insufficient|quota|payment|invalid x-api-key|authentication_error|permission_error|api key/.test(txt) || status === 401 || status === 402 || status === 403) return "ia_indisponivel";
  if (/rate.?limit|overloaded|429|529|too many requests/.test(txt) || status === 429 || status === 529) return "limite";
  if (/timeout|timed out|aborted|etimedout|statement timeout/.test(txt) || status === 504) return "tempo";
  return "interno";
}

const novoRef = () => Math.random().toString(36).slice(2, 8);

/** Regista o erro completo e devolve o corpo seguro para a resposta: { error, codigo, ref }. */
export function erroPublico(e, contexto = "api", extra = {}) {
  const codigo = classificarErro(e);
  const ref = novoRef();
  console.error(`[erro-publico] ${contexto} ref=${ref} codigo=${codigo}:`, e?.stack || e);
  return { error: MENSAGENS[codigo], codigo, ref, ...extra };
}

export const mensagemDoCodigo = (codigo) => MENSAGENS[codigo] || MENSAGENS.interno;
