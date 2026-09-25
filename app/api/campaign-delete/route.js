import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionRole, mandaNaCampanha } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

/**
 * POST {campaign_id} — apaga a campanha inteira (casting + a campanha). Ação do usuário,
 * com confirmação no front.
 *
 * Desde a partilha (set/2026) a rota confirma quem pede: um colega com quem o briefing
 * foi partilhado vê-o, mas não o apaga — só o dono ou um admin (mandaNaCampanha). Antes
 * qualquer sessão apagava qualquer id, o que com briefings individuais já era uma porta
 * a mais. O regime legado (sem dono) fica como sempre: qualquer utilizador.
 */
export async function POST(req) {
  try {
    const { campaign_id } = await req.json();
    if (!campaign_id) return NextResponse.json({ error: "campaign_id obrigatório" }, { status: 200 });
    const db = supabaseAdmin();
    const [{ user, role }, { data: camp }] = await Promise.all([
      sessionRole(),
      db.from("campaigns").select("id, user_id, shared_with").eq("id", campaign_id).maybeSingle(),
    ]);
    if (!camp) return NextResponse.json({ ok: true, aviso: "o briefing já não existia" });
    if (!mandaNaCampanha(camp, user?.id, role === "admin")) {
      return NextResponse.json({ error: "só o dono do briefing (ou um admin) pode apagá-lo" }, { status: 200 });
    }
    await db.from("campaign_creators").delete().eq("campaign_id", campaign_id);
    const { error } = await db.from("campaigns").delete().eq("id", campaign_id);
    return NextResponse.json(error ? { error: error.message } : { ok: true });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
