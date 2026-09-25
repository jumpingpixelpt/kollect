import { NextResponse } from "next/server";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { supabaseServer } from "@/lib/supabase";
import { fetchCreatorHubInsights } from "@/lib/creator-hub-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401, headers });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!uuid.test(id)) return NextResponse.json({ error: "Selecione um creator válido." }, { status: 400, headers });
  try {
    const data = await fetchCreatorHubInsights(supabaseServer, id);
    if (!data) return NextResponse.json({ error: "Creator não encontrado." }, { status: 404, headers });
    return NextResponse.json({ ok: true, ...data }, { headers });
  } catch {
    // Erro explícito: uma leitura interrompida nunca aparece como ausência de dados.
    return NextResponse.json({ error: "Não foi possível carregar os conteúdos. Tente novamente." }, { status: 500, headers });
  }
}
