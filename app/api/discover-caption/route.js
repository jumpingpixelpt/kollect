import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Descoberta por PALAVRA-NA-LEGENDA — Instagram (hashtag + filtro de legenda) e TikTok (busca por keyword).
 * GET ?src=both|tiktok|instagram &tags=... &kw=... &limit=40 &max=25
 * Grava prospects (fonte caption-ig / caption-tk) incrementalmente. Entram no pipeline normal.
 */
const SEED_TAGS = ["cabelofino", "cabeloralo", "quedadecabelo", "quedacapilar", "afinamentocapilar", "volumecapilar", "cabelocomvolume", "cabeloencorpado", "cabelocheio", "raizcomvolume", "cabelosemvolume", "cabeloquebradico", "pospartocabelo"];
const SEED_KW = [
  "cabelo fino", "cabelo ralo", "queda de cabelo", "queda capilar", "afinamento capilar", "cabelo afinando", "pos parto cabelo", "queda pos parto", "cabelo quebradico", "quebra capilar",
  "volume capilar", "cabelo com volume", "cabelo encorpado", "encorpar cabelo", "espessura do fio", "cabelo mais cheio", "raiz com volume", "cabelo sem volume", "cabelo murcho", "efeito blow dry",
  "como dar volume no cabelo", "meu cabelo afinou", "meu cabelo caiu", "penteado para cabelo fino", "finalizacao com volume", "rotina para queda de cabelo", "produto para cabelo fino",
];
const BIZ = ["loja", "store", "shop", "shampoo", "utilidades", "atacado", "distribuidora", "transplante", "cosmeticos br", "ecommerce", "e-commerce"];
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isBiz = (name, handle) => { const t = norm(`${name} ${handle}`); return BIZ.some((b) => t.includes(b)); };

async function apify(actor, input, timeout = 90) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
    const sp = new URL(req.url).searchParams;
    const src = (sp.get("src") || "both").toLowerCase();
    const tags = (sp.get("tags") ? sp.get("tags").split(",") : SEED_TAGS).map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
    const kws = (sp.get("kw") ? sp.get("kw").split(",") : SEED_KW).map((k) => norm(k.trim())).filter(Boolean);
    const limit = Math.min(Number(sp.get("limit")) || 40, 100);
    const max = Math.min(Number(sp.get("max")) || 25, 80);
    const db = supabaseAdmin();

    // Dedup PAGINADO. Sem o fetchAllRows o Supabase corta em 1000 linhas: de 41.613
    // prospects, o conjunto de conhecidos via 2,4% da base e pagavam-se de novo perfis que
    // já cá estavam — sem erro visível, porque o upsert usa ignoreDuplicates.
    const [crs, prs] = await Promise.all([
      fetchAllRows(() => db.from("creators").select("handle").order("handle")),
      fetchAllRows(() => db.from("prospects").select("handle").order("handle")),
    ]);
    const known = new Set([...crs, ...prs].map((x) => (x.handle || "").toLowerCase()).filter(Boolean));
    const seen = new Set();
    const today = new Date().toISOString().slice(0, 10);
    const amostra = [], errors = [];
    let scanned = 0, matched = 0, gravados = 0, descartadosBiz = 0, insErr = null;

    const save = async (rows) => { if (!rows.length) return; const { error } = await db.from("prospects").upsert(rows, { onConflict: "tubular_id", ignoreDuplicates: true }); if (error) insErr = error.message; else gravados += rows.length; };
    const consider = (handle, name, cap, followers, src, kw) => {
      const h = (handle || "").toLowerCase();
      if (!h) return null;
      if (known.has(h) || seen.has(h)) return null;
      if (isBiz(name, h)) { descartadosBiz++; return null; }
      seen.add(h);
      if (amostra.length < 18) amostra.push({ handle: h, name, kw, src, evidence: (cap || "").slice(0, 140) });
      return { tubular_id: `${src}:${h}`, handle: h, name: name || h, platform: src === "caption-tk" ? "tiktok" : "instagram", status: "descoberto", descoberto_em: today, fonte: src, termo: kw, followers: followers || null };
    };

    // ── TikTok: busca por keyword (legenda) ──
    if ((src === "both" || src === "tiktok") && gravados < max) {
      const queries = kws.slice(0, 10);
      let items = [];
      try { items = await apify("clockworks~tiktok-scraper", { searchQueries: queries, resultsPerPage: limit, shouldDownloadVideos: false, shouldDownloadCovers: false }, 120); }
      catch (e) { errors.push(`tiktok: ${String(e).slice(0, 140)}`); }
      const rows = [];
      for (const it of items) {
        scanned++;
        const cap = norm(it.text || it.desc || "");
        const handle = it.authorMeta?.name || it.authorMeta?.uniqueId || "";
        if (!handle || !cap) continue;
        const hit = kws.find((k) => cap.includes(k));
        if (!hit) continue;
        matched++;
        const row = consider(handle, it.authorMeta?.nickName, it.text || it.desc, it.authorMeta?.fans, "caption-tk", hit);
        if (row) rows.push(row);
        if (gravados + rows.length >= max) break;
      }
      await save(rows);
    }

    // ── Instagram: hashtag ampla + filtro de legenda ──
    if (src === "both" || src === "instagram") {
      for (const tag of tags) {
        if (gravados >= max) break;
        let items = [];
        try { items = await apify("apify~instagram-hashtag-scraper", { hashtags: [tag], resultsType: "posts", resultsLimit: limit }, 90); }
        catch (e) { errors.push(`ig ${tag}: ${String(e).slice(0, 120)}`); continue; }
        const rows = [];
        for (const it of items) {
          scanned++;
          const cap = norm(it.caption || it.text || "");
          const handle = it.ownerUsername || it.ownerUserName || it.username || "";
          if (!handle || !cap) continue;
          const hit = kws.find((k) => cap.includes(k));
          if (!hit) continue;
          matched++;
          const row = consider(handle, it.ownerFullName || it.fullName, it.caption || it.text, it.ownerFollowersCount, "caption-ig", hit);
          if (row) rows.push(row);
          if (gravados + rows.length >= max) break;
        }
        await save(rows);
      }
    }

    return NextResponse.json({ src, scanned, matched, gravados, descartadosBiz, insErr, errors, amostra });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
