import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { squadSearchTerm } from "@/lib/squad-input";
import { tagDaFicha } from "@/lib/casting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
  const term = squadSearchTerm(new URL(req.url).searchParams.get("q"));
  if (term.length < 2) return NextResponse.json({ creators: [] });
  // Underscore é literal de handle, não curinga do ILIKE.
  const pattern = term.replace(/_/g, "\\_");
  const { data, error } = await supabaseAdmin().from("creators")
    .select("id, name, handle, platform, followers, kol_geral:kol_score->geral")
    .or(`name.ilike.%${pattern}%,handle.ilike.%${pattern}%`).order("name").order("id").limit(20);
  if (error) return NextResponse.json({ error: "Não foi possível buscar os perfis." });
  return NextResponse.json({ creators: (data || []).map(({ kol_geral, ...creator }) => ({
    ...creator, tag: tagDaFicha({ kol_score: { geral: kol_geral } }),
  })) });
  } catch { return NextResponse.json({ error: "Não foi possível buscar os perfis." }); }
}
