import { NextResponse } from "next/server";
import { campanhaDoPedido } from "@/lib/casting-rota";
import { lerLinhas, montarCasting, filtrarVista, exportCasting } from "@/lib/casting-linhas";
import { erroPublico } from "@/lib/erro-publico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?id=<campanha>&tipo= — dados do CSV e da «defesa do casting» (components/CampaignActions.js)
 * com TODAS as linhas da tag escolhida, pedidos no clique em vez de irem embutidos na página
 * (paginação 20 a 20, 22/09/2026). A busca por nome não entra: é só navegação, como antes.
 * Resposta: { data, rationale }.
 */
export async function GET(req) {
  try {
    const sp = req.nextUrl.searchParams;
    const { camp, db, error } = await campanhaDoPedido(sp.get("id"));
    if (error) return NextResponse.json({ error }, { status: 200 });
    const rows = await lerLinhas(db, camp.id);
    const ctx = await montarCasting(db, camp, rows);
    const { porTipo } = filtrarVista(ctx, { tipo: sp.get("tipo") });
    return NextResponse.json({ data: exportCasting(ctx, porTipo), rationale: ctx.rationale });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "campanha-export"), { status: 200 });
  }
}
