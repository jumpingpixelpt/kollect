import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Promove em lote os prospects descobertos por legenda (TikTok/IG) via Apify — ZERO Influencer Club.
 * Drena a fila caption-tk / caption-ig (status 'descoberto') chamando promote-tiktok/promote-apify.
 * GET ?n=2  → promove os próximos N, retorna {promovidos, restantes}.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    const sp = new URL(req.url).searchParams;
    const n = Math.min(Number(sp.get("n")) || 2, 4);
    const base = new URL(req.url).origin;
    const db = supabaseAdmin();

    // paginado: com 1.762 creators o corte de 1000 do Supabase já escondia ~43% dos handles
    // conhecidos, e cada falso "desconhecido" é uma promoção paga em duplicado no Apify
    const known = new Set(
      (await fetchAllRows(() => db.from("creators").select("handle").order("handle")))
        .map((x) => (x.handle || "").toLowerCase())
    );
    const { data: fila } = await db.from("prospects")
      .select("tubular_id, handle, platform, fonte")
      .in("fonte", ["caption-tk", "caption-ig", "csv-liso"]).eq("status", "descoberto")
      .order("followers", { ascending: false, nullsFirst: false }).limit(60);
    const JUNK = ["serum","hair","dove","condicionador","shopping","unboxing","lorealparis_brasil"];
    const pend = (fila || []).filter((p) => p.handle && !known.has(p.handle.toLowerCase()) && !JUNK.includes(p.handle.toLowerCase()));

    const t0 = Date.now();
    const out = [];
    for (const p of pend.slice(0, n)) {
      if (Date.now() - t0 > 250000) break;
      const ep = p.platform === "tiktok" || p.fonte === "caption-tk" ? "promote-tiktok" : "promote-apify";
      try {
        const r = await fetch(`${base}/api/${ep}?tubular_id=${encodeURIComponent(p.tubular_id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(180000) }).then((x) => x.json()).catch((e) => ({ error: String(e).slice(0, 80) }));
        out.push({ handle: p.handle, classe: r?.classe ?? null, error: r?.error ?? null });
      } catch (e) { out.push({ handle: p.handle, error: String(e).slice(0, 80) }); }
    }
    return NextResponse.json({ promovidos: out.length, restantes: Math.max(0, pend.length - out.length), out });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
