// Complementos do lib/erro-publico.js para as rotas (feedback rodada 2, bug 1 — set/2026).
//
// 1. `respostaErro(req, e, contexto)`: o corpo seguro do erroPublico e, SÓ quando o pedido
//    traz o Bearer do CRON_SECRET (cron/orquestração — o /api/enrich regista o que os filhos
//    respondem), também o `detalhe` técnico truncado. Sessão de cookie (operador ou admin
//    na app) → nunca o detalhe: é o que o cliente via no ecrã.
// 2. `alertarIa(corpo, contexto)`: quando o erro é da nossa conta de IA (créditos/billing/
//    chave — codigo "ia_indisponivel"), grava em sweep_state para a casa ser avisada.
//    Best-effort: nunca derruba o pedido que o produziu.
import { erroPublico } from "@/lib/erro-publico";
import { supabaseAdmin } from "@/lib/supabase";

export function viaBearer(req) {
  const cron = process.env.CRON_SECRET;
  return !!(cron && req?.headers?.get?.("authorization") === `Bearer ${cron}`);
}

export function respostaErro(req, e, contexto, extra = {}) {
  const corpo = erroPublico(e, contexto, extra);
  if (viaBearer(req)) corpo.detalhe = String(e?.message || e || "").slice(0, 400);
  return corpo;
}

export async function alertarIa(corpo, contexto) {
  if (corpo?.codigo !== "ia_indisponivel") return;
  try {
    const em = new Date().toISOString();
    await supabaseAdmin().from("sweep_state").upsert(
      { key: "alerta_ia_indisponivel", value: { em, contexto, ref: corpo.ref }, updated_at: em },
      { onConflict: "key" }
    );
  } catch { /* o alerta nunca derruba a rota */ }
}
