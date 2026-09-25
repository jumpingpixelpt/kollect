import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const slugify = (x) =>
  String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Tags livres aplicaveis a creators (radar) E prospects (descoberta).
 * GET                                   -> todas as tags do cliente + contagem de uso
 * POST {action:"create", name, color?}  -> cria (ou devolve) a tag
 * POST {action:"apply", tag_id?|name?, color?, targets:[{creator_id?|prospect_id?}]}
 *                                        -> garante a tag e vincula os alvos (idempotente)
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const db = supabaseAdmin();
    const client = new URL(req.url).searchParams.get("client") || "loreal";
    const { data: tags } = await db.from("tags").select("*").eq("client", client).order("name");
    const ids = (tags ?? []).map((t) => t.id);
    const counts = {};
    if (ids.length) {
      const { data: tt } = await db.from("tag_targets").select("tag_id").in("tag_id", ids);
      for (const r of tt ?? []) counts[r.tag_id] = (counts[r.tag_id] || 0) + 1;
    }
    return NextResponse.json({ tags: (tags ?? []).map((t) => ({ ...t, n: counts[t.id] ?? 0 })) });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 }); }
}

async function ensureTag(db, { tag_id, name, color, client }) {
  if (tag_id) {
    const { data } = await db.from("tags").select("*").eq("id", tag_id).single();
    if (data) return data;
  }
  const slug = slugify(name);
  if (!slug) return null;
  const { data: existing } = await db.from("tags").select("*").eq("client", client).eq("slug", slug).maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("tags")
    .insert({ name: String(name).trim(), slug, client, color: color ?? null }).select("*").single();
  if (error) {
    const { data: again } = await db.from("tags").select("*").eq("client", client).eq("slug", slug).maybeSingle();
    return again ?? null;
  }
  return data;
}

export async function POST(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const db = supabaseAdmin();
    const body = await req.json();
    const client = body.client || "loreal";

    if (body.action === "create") {
      const tag = await ensureTag(db, { name: body.name, color: body.color, client });
      if (!tag) return NextResponse.json({ error: "nome da tag vazio" }, { status: 200 });
      return NextResponse.json({ ok: true, tag });
    }

    if (body.action === "apply") {
      const tag = await ensureTag(db, { tag_id: body.tag_id, name: body.name, color: body.color, client });
      if (!tag) return NextResponse.json({ error: "tag invalida (informe tag_id ou name)" }, { status: 200 });
      const targets = Array.isArray(body.targets) ? body.targets : [];
      const rows = targets
        .map((t) => ({
          tag_id: tag.id,
          creator_id: t.creator_id ?? null,
          prospect_id: t.creator_id ? null : (t.prospect_id ?? null),
        }))
        .filter((r) => r.creator_id || r.prospect_id);
      if (!rows.length) return NextResponse.json({ ok: true, tag, applied: 0 });
      // dedup no app (indices unicos parciais nao sao inferiveis por ON CONFLICT): le quem ja tem a tag
      const { data: cur } = await db.from("tag_targets").select("creator_id, prospect_id").eq("tag_id", tag.id);
      const hasC = new Set((cur ?? []).filter((r) => r.creator_id).map((r) => r.creator_id));
      const hasP = new Set((cur ?? []).filter((r) => r.prospect_id).map((r) => r.prospect_id));
      const fresh = rows.filter((r) => r.creator_id ? !hasC.has(r.creator_id) : !hasP.has(r.prospect_id));
      if (!fresh.length) return NextResponse.json({ ok: true, tag, applied: 0 });
      const { error } = await db.from("tag_targets").insert(fresh);
      return NextResponse.json({ ok: !error, tag, applied: error ? 0 : fresh.length, error: error?.message ?? null });
    }

    return NextResponse.json({ error: "acao desconhecida" }, { status: 200 });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 }); }
}
