import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** GET ?campaign=ID — status (só leitura) do all-in: quantos creators do casting já foram processados. */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const campaign = new URL(req.url).searchParams.get("campaign") || "81141cef-82ee-4afd-8add-ad5fd7061833";
    const db = supabaseAdmin();
    const { data: cc } = await db.from("campaign_creators").select("creator_id").eq("campaign_id", campaign);
    const ids = [...new Set((cc || []).map((x) => x.creator_id))].filter(Boolean);
    const { data: all } = await db.from("creators").select("kol_screen").in("id", ids);
    const total = ids.length;
    const feitos = (all || []).filter((c) => c.kol_screen && c.kol_screen.allin_em && c.kol_screen.allin_em !== 'processando').length;
    const em_andamento = (all || []).filter((c) => c.kol_screen && c.kol_screen.allin_em === 'processando').length;
    const pct = total ? Math.round((feitos / total) * 100) : 0;
    return NextResponse.json({ all_in: `${feitos}/${total}`, feitos, em_andamento, total, restantes: total - feitos, pct: `${pct}%`, concluido: feitos >= total });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 200) }, { status: 200 }); }
}
