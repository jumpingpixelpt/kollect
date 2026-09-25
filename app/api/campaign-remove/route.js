import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { linhaCastingDoPedido } from "@/lib/casting-rota";

export const dynamic = "force-dynamic";

/** POST {row_id} — remove definitivamente uma creator/prospect do casting da campanha.
 *  Apaga apenas a linha em campaign_creators (a creator continua ativa no radar/plataforma). */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const { row_id } = await req.json();
    if (!row_id) return NextResponse.json({ error: "row_id obrigatório" }, { status: 200 });
    // a linha pertence a um briefing que o utilizador vê? (pentest set/2026, IDOR)
    const acesso = await linhaCastingDoPedido(row_id, req);
    if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });
    const db = supabaseAdmin();
    const { error } = await db.from("campaign_creators").delete().eq("id", row_id);
    return NextResponse.json(error ? { error: error.message } : { ok: true });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
