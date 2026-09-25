import { NextResponse } from "next/server";
import { internalHeaders } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";
import { campanhaDoPedido } from "@/lib/casting-rota";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET ?campaign=ID&n=4 — all-in em lote PARALELO. Pra cada creator do casting sem all-in:
 * claim (allin_em='processando' p/ evitar corrida) -> deep-scan (Apify+Groq) -> brand-scan -> kol-screen
 * -> kol-score -> marca allin_em=data. Em falha, reverte o claim p/ retry. Drena em ondas via Vercel Cron.
 * O kol-score entrou na cadeia (02/ago/2026): sem ele, o creator saía do all-in com kol_screen
 * fresco mas Score KOL calculado antes do deep-scan — inelegível por falta de métricas, "—" nos
 * castings. O enrich já o fazia; o all-in em lote é que tinha ficado para trás.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "transcribe-casting", max: 6, janelaMs: 60_000 });
  if (travado) return travado;
  try {
    const sp = new URL(req.url).searchParams;
    const base = new URL(req.url).origin;
    const campaign = sp.get("campaign") || "81141cef-82ee-4afd-8add-ad5fd7061833";
    const n = Math.min(Number(sp.get("n")) || 4, 6);
    // só quem vê o briefing dispara o all-in do casting dele (pentest set/2026); o cron passa pelo bearer
    const acesso = await campanhaDoPedido(campaign, req);
    if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });
    const db = supabaseAdmin();

    const { data: cc } = await db.from("campaign_creators").select("creator_id").eq("campaign_id", campaign);
    const ids = [...new Set((cc || []).map((x) => x.creator_id))].filter(Boolean);
    if (!ids.length) return NextResponse.json({ error: "campanha sem casting" }, { status: 200 });

    const { data: all } = await db.from("creators").select("id, handle, kol_screen").in("id", ids);
    const pendentes = (all || []).filter((c) => !(c.kol_screen && c.kol_screen.allin_em));
    const lote = pendentes.slice(0, n);

    // claim imediato (evita corrida entre execuções sobrepostas do cron)
    await Promise.all(lote.map((c) =>
      db.from("creators").update({ kol_screen: { ...(c.kol_screen || {}), allin_em: "processando" } }).eq("id", c.id)
    ));

    const processaUm = async (c) => {
      const r = { handle: c.handle, classe_antes: c.kol_screen?.classe ?? null };
      try {
        await fetch(`${base}/api/deep-scan?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders() }).then((x) => x.json()).catch(() => {});
        await fetch(`${base}/api/brand-scan?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders() }).then((x) => x.json()).catch(() => {});
        await fetch(`${base}/api/kol-screen?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders() }).then((x) => x.json()).catch(() => {});
        await fetch(`${base}/api/kol-score?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders() }).then((x) => x.json()).catch(() => {});
        await fetch(`${base}/api/creator-embeddings?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders() }).then((x) => x.json()).catch(() => {});
        const { data: fresh } = await db.from("creators").select("kol_screen").eq("id", c.id).single();
        const ks = fresh?.kol_screen || {};
        ks.allin_em = new Date().toISOString().slice(0, 10);
        await db.from("creators").update({ kol_screen: ks }).eq("id", c.id);
        r.ok = true; r.classe_depois = ks.classe ?? null;
      } catch (e) {
        const { data: fr } = await db.from("creators").select("kol_screen").eq("id", c.id).single();
        const ks = fr?.kol_screen || {}; if (ks.allin_em === "processando") delete ks.allin_em;
        await db.from("creators").update({ kol_screen: ks }).eq("id", c.id);
        r.ok = false; r.erro = String(e).slice(0, 100);
      }
      return r;
    };

    const out = await Promise.all(lote.map(processaUm));
    return NextResponse.json({ casting: ids.length, processados: out.length, restantes: pendentes.length - out.length, resultados: out });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
