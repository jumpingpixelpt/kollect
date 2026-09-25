import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — diagnóstico do ambiente (não expõe valores, só estado). */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  // ?promotetest=1 — isola a query de prospects e a resolução de handle
  if (new URL(req.url).searchParams.get("promotetest")) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: top, error } = await db.from("prospects").select("tubular_id, name")
        .or("status.eq.novo,status.like.vids*,status.like.handle*,status.like.falha*,status.like.erro*")
        .order("mini_score", { ascending: false }).limit(2);
      let oembed = null;
      try {
        const oe = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent("https://www.tiktok.com/@redirect-to/video/7561916966663965960")).then((r) => r.json());
        oembed = { author: oe?.author_unique_id ?? null, keys: Object.keys(oe || {}).slice(0, 8) };
      } catch (e) { oembed = { err: String(e).slice(0, 80) }; }
      return NextResponse.json({ query_error: error?.message ?? null, top: top?.map((t) => t.name) ?? null, oembed });
    } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 200) }); }
  }

  // ?thumbtest=1 — testa server-side uma capa do Instagram gravada no banco
  if (new URL(req.url).searchParams.get("thumbtest")) {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await db.from("videos").select("thumb").like("thumb", "%cdninstagram%").limit(3);
    const out = [];
    for (const row of data || []) {
      try {
        const r = await fetch(row.thumb, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "image/*" } });
        out.push({ status: r.status, type: r.headers.get("content-type"), url: row.thumb.slice(0, 60) });
      } catch (e) { out.push({ err: String(e).slice(0, 100) }); }
    }
    // testa também o endpoint /media/ derivado da URL do vídeo
    try {
      const r = await fetch("https://www.instagram.com/p/DXaQzTljwnZ/media/?size=l", {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "image/*" },
      });
      out.push({ media_endpoint: r.status, type: r.headers.get("content-type"), final: r.url.slice(0, 70) });
    } catch (e) { out.push({ media_endpoint_err: String(e).slice(0, 100) }); }
    return NextResponse.json({ thumbtest: out });
  }
  const env = {
    TUBULAR_API_KEY: !!process.env.TUBULAR_API_KEY,
    APIFY_TOKEN: !!process.env.APIFY_TOKEN,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };

  let apify = "sem token";
  if (process.env.APIFY_TOKEN) {
    try {
      const r = await fetch(`https://api.apify.com/v2/users/me?token=${process.env.APIFY_TOKEN}`);
      const j = await r.json().catch(() => ({}));
      apify = r.ok ? `ok (${j.data?.username || "autenticado"})` : `erro ${r.status}`;
    } catch (e) { apify = `falha: ${String(e).slice(0, 80)}`; }
  }

  let groq = "sem chave";
  if (process.env.GROQ_API_KEY) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
      groq = r.ok ? "ok" : `erro ${r.status}`;
    } catch (e) { groq = `falha: ${String(e).slice(0, 80)}`; }
  }

  let tubular = "sem chave";
  if (process.env.TUBULAR_API_KEY) {
    try {
      const r = await fetch("https://tubularlabs.com/api/v4/creator.search", {
        method: "POST",
        headers: { "Api-Key": process.env.TUBULAR_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ include: { search: "loreal" }, fields: { snippet: true }, scroll: { size: 1 } }),
      });
      tubular = r.ok ? "ok" : `erro ${r.status}`;
    } catch (e) { tubular = `falha: ${String(e).slice(0, 80)}`; }
  }
  return NextResponse.json({ env, apify, groq, tubular, version: "v17-backfill" });
}
