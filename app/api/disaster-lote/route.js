import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { resumoDisaster } from "@/lib/disaster";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Disaster check para a base inteira, gravado em kol_screen.disaster — sem IA, sem Apify.
 *
 * O /api/kol-screen passou a gravar o resumo do disaster check (feedback do cliente,
 * set/2026, ponto 10: quem não passa não entra na lista do briefing), mas só corre em quem
 * passa pela cadeia. Esta rota preenche os já avaliados a partir do que está no banco
 * (bio, legendas, falas transcritas), para a regra valer nos castings existentes.
 *
 * GET ?lote=200[&offset=0] — admin ou bearer; repetir com offset até `restantes` ser 0.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const lote = Math.min(Math.max(Number(sp.get("lote")) || 200, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const db = supabaseAdmin();
  const { data: creators, count } = await db.from("creators").select("id, handle, bio, kol_screen", { count: "exact" }).order("id").range(offset, offset + lote - 1);
  const niveis = {};
  const altos = [];
  let gravados = 0;
  for (const c of creators ?? []) {
    const { data: vids } = await db.from("videos").select("title, transcript, url, posted_at").eq("creator_id", c.id);
    const disaster = resumoDisaster({ bio: c.bio, videos: vids ?? [] });
    niveis[disaster.nivel] = (niveis[disaster.nivel] || 0) + 1;
    if (disaster.nivel === "alto") altos.push(`${c.handle}: ${disaster.sinais.join(", ")}`);
    const { error } = await db.from("creators").update({ kol_screen: { ...(c.kol_screen || {}), disaster } }).eq("id", c.id);
    if (!error) gravados++;
  }
  const proximo = offset + (creators?.length ?? 0);
  return NextResponse.json({ lote, offset, processados: creators?.length ?? 0, gravados, niveis, altos, total: count, restantes: Math.max(0, (count ?? 0) - proximo), proximo_offset: proximo, versao: "2026-09-11b" });
}
