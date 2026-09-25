import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Remove uma descoberta (linha de prospects) do funil.
 * GET ?tubular_id=X ou POST { tubular_id }.
 *
 * Pedido do operador (jul/2026): toda descoberta em erro — homónima suspeita, @ não
 * resolvido, perfil privado — tem de poder sair da fila, senão fica a poluir a página
 * para sempre. Ao contrário do creator-delete não há nada pago a perder: o prospect é
 * só a entrada do funil (tag_targets cai em cascata; nas campanhas a linha de casting
 * fica e a ficha ignora prospects inexistentes). Se uma varredura futura voltar a
 * encontrar o perfil, ele volta a entrar — remover não é banir.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  const tid = new URL(req.url).searchParams.get("tubular_id");
  return remover(tid);
}

export async function POST(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  const body = await req.json().catch(() => ({}));
  return remover(body?.tubular_id);
}

async function remover(tid) {
  try {
    if (!tid) return NextResponse.json({ error: "tubular_id obrigatório" }, { status: 200 });
    const db = supabaseAdmin();
    // briefing_members.prospect_id não tem FK para prospects (a tabela é de ago/2026, posterior
    // a esta rota) e a briefing_member_view usa LEFT JOIN — apagar só o prospect deixava no
    // briefing um cartão-fantasma sem nome nem score, pior do que a descoberta em erro que se
    // queria remover. Sai o vínculo primeiro: quem já virou creator tem creator_id próprio na
    // linha e não depende do prospect, por isso só se apagam os vínculos ainda por promover.
    const { data: vinculos } = await db.from("briefing_members")
      .delete().eq("prospect_id", tid).is("creator_id", null).select("id");
    const { data, error } = await db.from("prospects").delete().eq("tubular_id", tid).select("tubular_id, name, handle");
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    if (!data?.length) return NextResponse.json({ error: "prospect não encontrado (já removido?)" }, { status: 200 });
    return NextResponse.json({ ok: true, removido: data[0], vinculos_briefing: vinculos?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 });
  }
}
