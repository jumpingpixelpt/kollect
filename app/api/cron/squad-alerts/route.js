import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { isSquadEmailConfigured, processSquadAlerts } from "@/lib/squad-notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  // Verificação de implantação: informa apenas presença de configuração,
  // sem expor credenciais, consultar destinatários ou disparar a fila.
  if (new URL(req.url).searchParams.get("diagnostico") === "1") {
    return NextResponse.json({ ok: true, enabled: isSquadEmailConfigured(),
      configuration: { enabledFlag: process.env.SQUAD_ALERTS_ENABLED === "1",
        providerKey: Boolean(process.env.RESEND_API_KEY?.trim()),
        sender: Boolean(process.env.SQUAD_EMAIL_FROM?.trim()),
        preview: process.env.VERCEL_ENV === "preview" } });
  }
  if (!isSquadEmailConfigured()) return NextResponse.json({ ok: true, skipped: "e-mail de squads não configurado ou ambiente de preview" });
  try {
    return NextResponse.json(await processSquadAlerts(supabaseAdmin()));
  } catch (error) {
    return NextResponse.json({ error: String(error.message).slice(0, 300) });
  }
}
