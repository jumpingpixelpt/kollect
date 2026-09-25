import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { campanhaDoPedido } from "@/lib/casting-rota";

export const dynamic = "force-dynamic";

/** POST {campaign_id} — aprova o "squad recomendado": papéis-núcleo do casting
 *  (Authority Lead + Discovery Bet + Efficiency Play). Scale Support e Out of Territory
 *  ficam de fora — são escala/avaliar conforme budget. Ação do usuário, com confirmação no front. */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) return NextResponse.json({ error: "campaign_id obrigatório" }, { status: 200 });
    // posse do briefing (pentest set/2026, IDOR)
    const acesso = await campanhaDoPedido(campaign_id, req);
    if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });
    const db = supabaseAdmin();
    const core = ["authority_anchor", "rising_bet", "hidden_opportunity"];
    const { data, error } = await db
      .from("campaign_creators")
      .update({ status: "aprovada" })
      .eq("campaign_id", campaign_id)
      .in("campaign_role", core)
      .neq("status", "descartada")
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true, aprovadas: (data || []).length });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
