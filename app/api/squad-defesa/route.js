import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { sessionRole, veCampanha } from "@/lib/auth-server";
import { validSquadId } from "@/lib/squad-input";
import { iniciaisDe } from "@/lib/squad-data";
import { carregarContextoDefesa, defesaModelo, promptDefesa } from "@/lib/defesa-squad";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { alertarIa } from "@/lib/erro-rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Defesa do squad (feedback rodada 2, F2.3 — set/2026; proposta da D8). Ver lib/defesa-squad.js.
 *
 * POST { list_id } → { ok, defesa: { texto, fonte: "ia" | "modelo", gerada_em, por } }
 *
 * Gera a partir dos membros ACTUAIS do squad (incluindo externos, curadoria e notas), do
 * briefing ligado e dos big numbers. Tenta o Haiku; se falhar por qualquer motivo (créditos,
 * limite, tempo, resposta vazia), usa o texto determinístico — a pessoa recebe sempre uma
 * defesa, e `fonte` diz qual. A falha da IA vai para os logs (erroPublico) e, se for da
 * nossa conta, para o alerta da casa (alertarIa); nunca para o ecrã.
 *
 * A última defesa fica em lists.defesa, para reabrir sem pagar outra chamada.
 * Mesma regra de acesso das outras ações do squad (squads são da equipa); o texto do
 * briefing só entra se quem pede o puder ver (briefings são individuais — veCampanha).
 */
const MODEL = "claude-haiku-4-5-20251001";

async function gerarComIa(ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content: promptDefesa(ctx) }] }),
    signal: AbortSignal.timeout(45000),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new ErroProvedor("anthropic", res.status, out);
  // o modelo insiste em markdown apesar do pedido (como no briefing-sintese)
  const texto = String(out?.content?.[0]?.text ?? "")
    .replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").trim();
  if (texto.length < 200) throw new Error("squad-defesa: o modelo não devolveu texto suficiente");
  return texto;
}

export async function POST(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    if (!validSquadId(body.list_id)) return NextResponse.json({ error: "Squad inválido." });
    const db = supabaseAdmin();
    // pelo Bearer (sem sessão) não há quem ver: o briefing entra, como nas outras rotas internas
    const { user, role } = await sessionRole().catch(() => ({ user: null, role: null }));
    const podeVerBriefing = (camp) => !user || veCampanha(camp, user.id, role === "admin");
    const ctx = await carregarContextoDefesa(db, body.list_id, { podeVerBriefing });
    if (!ctx) return NextResponse.json({ error: "Squad não encontrado." });

    let texto, fonte = "ia";
    try {
      texto = await gerarComIa(ctx);
    } catch (e) {
      const corpo = erroPublico(e, "squad-defesa");
      await alertarIa(corpo, "squad-defesa");
      texto = defesaModelo(ctx);
      fonte = "modelo";
    }
    const defesa = { texto, fonte, gerada_em: new Date().toISOString(), por: user?.id ?? null };
    const { error } = await db.from("lists").update({ defesa }).eq("id", body.list_id);
    // não gravar não impede de mostrar: a pessoa copia/baixa agora; só não reabre com ela
    const aviso = error ? "Defesa gerada, mas não foi possível guardá-la para a próxima visita." : undefined;
    if (error) console.error("[squad-defesa] gravar lists.defesa:", error.message);
    return NextResponse.json({ ok: true, defesa: { ...defesa, por: user ? iniciaisDe(user) : null }, aviso });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "squad-defesa"), { status: 200 });
  }
}
