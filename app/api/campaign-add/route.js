import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { campanhaDoPedido } from "@/lib/casting-rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inclusao manual de creators/prospects no casting de uma campanha (kind="manual").
 * POST {campaign_id, items:[{creator_id?|prospect_id?, match_score?}]}
 * Idempotente: nao duplica quem ja esta no casting da campanha.
 */
export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const db = supabaseAdmin();
    const { campaign_id, items = [] } = await req.json();
    if (!campaign_id) return NextResponse.json({ error: "campaign_id ausente" }, { status: 200 });
    // posse do briefing (pentest set/2026, IDOR)
    const acesso = await campanhaDoPedido(campaign_id, req);
    if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });

    const { data: existing } = await db.from("campaign_creators")
      .select("creator_id, prospect_id").eq("campaign_id", campaign_id);
    const hasC = new Set((existing ?? []).filter((r) => r.creator_id).map((r) => r.creator_id));
    const hasP = new Set((existing ?? []).filter((r) => r.prospect_id).map((r) => r.prospect_id));

    const rows = [];
    for (const it of items) {
      const cid = it.creator_id ?? null;
      const pid = cid ? null : (it.prospect_id ?? null);
      if (!cid && !pid) continue;
      if (cid && hasC.has(cid)) continue;
      if (pid && hasP.has(pid)) continue;
      if (cid) hasC.add(cid); else hasP.add(pid);
      rows.push({ campaign_id, creator_id: cid, prospect_id: pid, kind: "manual", status: "sugerida", match_score: it.match_score ?? null, rationale: "Adicionada manualmente" });
    }
    if (!rows.length) return NextResponse.json({ ok: true, added: 0 });
    const { error } = await db.from("campaign_creators").insert(rows);
    return NextResponse.json({ ok: !error, added: error ? 0 : rows.length, error: error?.message ?? null });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 }); }
}
