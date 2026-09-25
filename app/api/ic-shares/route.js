import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { podeGastar, registarSaldo } from "@/lib/ic-budget";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx [&n=10] — busca o share_count real dos posts de Instagram
 * via influencers.club Post Details (0,03 crédito/post) e grava em videos.shares.
 * Alimenta a Taxa de Viralização (shares+saves ÷ views) nas meninas de IG.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "ic-shares", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const handle = sp.get("handle");
  const n = Number(sp.get("n")) || 10;
  const db = supabaseAdmin();

  const { data: c } = await db.from("creators").select("id, handle, platform").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
  if (c.platform !== "instagram") return NextResponse.json({ ok: true, msg: "só Instagram precisa (TikTok já tem shares)" });

  const { data: vids } = await db.from("videos")
    .select("id, url, views").eq("creator_id", c.id).is("shares", null).not("url", "is", null)
    .order("views", { ascending: false, nullsFirst: false }).limit(n);
  if (!vids?.length) return NextResponse.json({ ok: true, msg: "nada a preencher" });

  // Piso antes de gastar. Esta rota saiu da cadeia de /api/enrich em jul/2026 (era 0,03
  // crédito/post em todo creator de IG enriquecido, ~431 créditos latentes) e passou a
  // corrida manual dirigida — mas manual não quer dizer sem travão: 10 posts é meio crédito
  // e a fila inteira eram 14.368 posts.
  const orc = await podeGastar(vids.length * 0.03, { lote: true });
  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_ic: orc.saldo, posts_na_fila: vids.length }, { status: 200 });

  let atualizados = 0, custo = 0, saldoVisto = null;
  for (const v of vids) {
    const code = (v.url.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/) || [])[1];
    if (!code) continue;
    try {
      const r = await fetch("https://api-dashboard.influencers.club/public/v1/creators/content/details/", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "instagram", post_id: code, content_type: "data" }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => null);
      const m = j?.result?.metrics;
      if (!r.ok || !m) continue;
      custo += Number(j?.credits_cost ?? 0.03);
      // o IC devolve o saldo em cada resposta e isto era deitado fora — foi essa cegueira
      // que deixou confundir plano anual com mensal (post-mortem §2.6)
      if (Number.isFinite(Number(j?.credits_left))) saldoVisto = Number(j.credits_left);
      const upd = {};
      if (m.share_count != null) upd.shares = m.share_count;
      if (m.save_count != null) upd.saves = m.save_count;
      if (m.play_count != null && v.views == null) upd.views = m.play_count;
      if (Object.keys(upd).length) {
        await db.from("videos").update(upd).eq("id", v.id);
        atualizados++;
      }
      await new Promise((s) => setTimeout(s, 250));
    } catch { /* segue pro próximo */ }
  }

  if (saldoVisto != null) await registarSaldo(saldoVisto, "ic-shares");

  return NextResponse.json({
    creator: handle, posts_consultados: vids.length, atualizados,
    creditos: Math.round(custo * 100) / 100, saldo_ic: saldoVisto ?? orc.saldo,
  });
}
