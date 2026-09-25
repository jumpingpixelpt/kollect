import { NextResponse } from "next/server";
import { campanhaDoPedido } from "@/lib/casting-rota";
import { lerLinhas, montarCasting, filtrarVista, paginar, resumoLinha, POR_PAGINA } from "@/lib/casting-linhas";
import { erroPublico } from "@/lib/erro-publico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?id=<campanha>&offset=&limit=20&tipo=&q= — as linhas seguintes da lista de Creators de
 * um briefing, só o resumo da linha fechada (lib/casting-linhas.js; paginação 20 a 20,
 * 22/09/2026). Mesmos filtros, ordem e dedupe da página: a montagem é a mesma função.
 * Resposta: { linhas, total, offset }.
 */
export async function GET(req) {
  try {
    const sp = req.nextUrl.searchParams;
    const { camp, db, error } = await campanhaDoPedido(sp.get("id"));
    if (error) return NextResponse.json({ error }, { status: 200 });
    const rows = await lerLinhas(db, camp.id);
    const ctx = await montarCasting(db, camp, rows);
    const { mostradas } = filtrarVista(ctx, { tipo: sp.get("tipo"), q: sp.get("q") });
    const offset = Math.max(0, Math.floor(Number(sp.get("offset")) || 0));
    const linhas = paginar(mostradas, offset, sp.get("limit") || POR_PAGINA).map((r) => resumoLinha(ctx, r));
    return NextResponse.json({ linhas, total: mostradas.length, offset });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "campanha-linhas"), { status: 200 });
  }
}
