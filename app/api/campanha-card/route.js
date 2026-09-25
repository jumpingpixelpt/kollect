import { NextResponse } from "next/server";
import { campanhaDoPedido } from "@/lib/casting-rota";
import { montarCard, ehUuid } from "@/lib/casting-linhas";
import { erroPublico } from "@/lib/erro-publico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?id=<campanha>&creator=<creator_id> — o card aberto de uma linha da lista de Creators
 * de um briefing, pedido quando a linha se abre pela primeira vez (lib/casting-linhas.js,
 * montarCard; paginação 20 a 20, 22/09/2026). Resposta: { card }.
 */
export async function GET(req) {
  try {
    const sp = req.nextUrl.searchParams;
    const creator = sp.get("creator");
    if (!ehUuid(creator)) return NextResponse.json({ error: "Creator inválido." }, { status: 200 });
    const { camp, db, error } = await campanhaDoPedido(sp.get("id"));
    if (error) return NextResponse.json({ error }, { status: 200 });
    const card = await montarCard(db, camp, creator);
    if (!card) return NextResponse.json({ error: "Esta creator já não está no casting deste briefing." }, { status: 200 });
    return NextResponse.json({ card });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "campanha-card"), { status: 200 });
  }
}
