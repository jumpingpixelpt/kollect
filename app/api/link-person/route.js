import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** GET ?handles=a,b — vincula contas como a mesma pessoa (person_key compartilhado). */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const handles = (new URL(req.url).searchParams.get("handles") || "")
    .split(",").map((h) => h.trim()).filter(Boolean);
  if (handles.length < 2) return NextResponse.json({ error: "passe 2+ handles separados por vírgula" }, { status: 400 });

  const db = supabaseAdmin();
  // as duas contas têm de existir: ligar a um @ que não está na base gravaria um person_key
  // numa conta só, sem par (botão "Ligar a outra conta" da ficha, 11/09/2026)
  const { data: existem } = await db.from("creators").select("handle").in("handle", handles);
  const faltam = handles.filter((h) => !(existem ?? []).some((e) => e.handle === h));
  if (faltam.length) return NextResponse.json({ error: `não está no radar: @${faltam.join(", @")} — avalie primeiro em Validar creator` }, { status: 200 });
  // reusa um person_key existente do grupo, senão cria a partir do primeiro handle
  const { data: existing } = await db.from("creators").select("person_key").in("handle", handles).not("person_key", "is", null).limit(1);
  const key = existing?.[0]?.person_key || handles[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { error } = await db.from("creators").update({ person_key: key }).in("handle", handles);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ person_key: key, handles });
}
