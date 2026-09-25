import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Briefings: o pedido do cliente como objeto de primeira classe (brief-first).
 *
 * A diferença para as listas é a ordem: a lista é members-first (escolho creators,
 * o grupo é operacional); o briefing é brief-first — primeiro existe o pedido
 * (nome + caracterização), e os membros vão sendo anexados como candidatos que
 * respondem a esse pedido, a partir das Descobertas.
 *
 * GET            → todos os briefings com contagem de membros
 * GET ?id=       → briefing + membros (com creator/prospect resolvidos)
 * POST {name, caracterizacao}              → cria briefing (pode nascer vazio)
 * POST {action:"update", briefing_id,...}  → edita nome/caracterização
 * POST {action:"add_members", ...}         → anexa candidatos (dedupe)
 * POST {action:"remove_member", ...}       → tira um candidato (não toca no creator)
 * POST {action:"delete_briefing", ...}     → apaga o briefing e os seus membros
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    const db = supabaseAdmin();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      const { data: briefings } = await db.from("briefings").select("*").order("created_at", { ascending: false });
      const ids = (briefings ?? []).map((b) => b.id);
      const counts = {};
      if (ids.length) {
        const { data: members } = await db.from("briefing_members").select("briefing_id").in("briefing_id", ids);
        for (const m of members ?? []) counts[m.briefing_id] = (counts[m.briefing_id] ?? 0) + 1;
      }
      return NextResponse.json({ briefings: (briefings ?? []).map((b) => ({ ...b, total: counts[b.id] ?? 0 })) });
    }
    const [{ data: briefing }, { data: members }] = await Promise.all([
      db.from("briefings").select("*").eq("id", id).single(),
      db.from("briefing_members").select("*").eq("briefing_id", id).order("created_at"),
    ]);
    const cIds = (members ?? []).filter((m) => m.creator_id).map((m) => m.creator_id);
    const pIds = (members ?? []).filter((m) => !m.creator_id && m.prospect_id).map((m) => m.prospect_id);
    const [{ data: creators }, { data: prospects }] = await Promise.all([
      cIds.length ? db.from("leaderboard").select("id, name, handle, platform, followers, total").in("id", cIds) : Promise.resolve({ data: [] }),
      pIds.length ? db.from("prospects").select("tubular_id, name, handle, platform, followers, mini_score, termo").in("tubular_id", pIds) : Promise.resolve({ data: [] }),
    ]);
    const cBy = {}; for (const c of creators ?? []) cBy[c.id] = c;
    const pBy = {}; for (const p of prospects ?? []) pBy[p.tubular_id] = p;
    const enriched = (members ?? []).map((m) => ({ ...m, creator: m.creator_id ? cBy[m.creator_id] : null, prospect: m.prospect_id ? pBy[m.prospect_id] : null }));
    return NextResponse.json({ briefing, members: enriched });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 }); }
}

export async function POST(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    const db = supabaseAdmin();
    const body = await req.json();

    if (body.action === "update") {
      const { briefing_id, name, caracterizacao } = body;
      if (!briefing_id) return NextResponse.json({ error: "briefing_id ausente" }, { status: 200 });
      const patch = {};
      if (name != null) { if (!name.trim()) return NextResponse.json({ error: "nome do briefing vazio" }, { status: 200 }); patch.name = name.trim(); }
      if (caracterizacao != null) patch.caracterizacao = caracterizacao.trim() || null;
      if (!Object.keys(patch).length) return NextResponse.json({ error: "nada para atualizar" }, { status: 200 });
      const { error } = await db.from("briefings").update(patch).eq("id", briefing_id);
      return NextResponse.json({ ok: !error, error: error?.message ?? null });
    }

    if (body.action === "add_members") {
      const { briefing_id, items: addItems = [] } = body;
      if (!briefing_id) return NextResponse.json({ error: "briefing_id ausente" }, { status: 200 });
      // dedupe só contra os ids que CHEGAM: carregar os membros todos esbarrava no
      // tecto de 1000 linhas do PostgREST com briefings grandes (10k+ candidatos), e
      // o dedupe furava em silêncio a partir daí
      const incC = [...new Set(addItems.map((i) => i.creator_id).filter(Boolean))];
      const incP = [...new Set(addItems.filter((i) => !i.creator_id).map((i) => i.prospect_id).filter(Boolean))];
      const [{ data: curC }, { data: curP }] = await Promise.all([
        incC.length ? db.from("briefing_members").select("creator_id").eq("briefing_id", briefing_id).in("creator_id", incC) : Promise.resolve({ data: [] }),
        incP.length ? db.from("briefing_members").select("prospect_id").eq("briefing_id", briefing_id).in("prospect_id", incP) : Promise.resolve({ data: [] }),
      ]);
      const hasC = new Set((curC ?? []).map((r) => r.creator_id));
      const hasP = new Set((curP ?? []).map((r) => r.prospect_id));
      const rows = [];
      for (const it of addItems) {
        const cid = it.creator_id ?? null;
        const pid = cid ? null : (it.prospect_id ?? null);
        if (!cid && !pid) continue;
        if (cid && hasC.has(cid)) continue;
        if (pid && hasP.has(pid)) continue;
        if (cid) hasC.add(cid); else hasP.add(pid);
        rows.push({ briefing_id, creator_id: cid, prospect_id: pid, termo: it.termo ?? null });
      }
      if (!rows.length) return NextResponse.json({ ok: true, added: 0 });
      const { error } = await db.from("briefing_members").insert(rows);
      return NextResponse.json({ ok: !error, added: error ? 0 : rows.length, error: error?.message ?? null });
    }

    if (body.action === "remove_member") {
      const { briefing_id, member_id } = body;
      if (!briefing_id || !member_id) return NextResponse.json({ error: "briefing_id e member_id obrigatórios" }, { status: 200 });
      const { data, error } = await db.from("briefing_members").delete().eq("id", member_id).eq("briefing_id", briefing_id).select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
      if (!data?.length) return NextResponse.json({ error: "membro não encontrado (já removido?)" }, { status: 200 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete_briefing") {
      const { briefing_id } = body;
      if (!briefing_id) return NextResponse.json({ error: "briefing_id ausente" }, { status: 200 });
      // filhos primeiro, sem depender de CASCADE no schema
      const { error: me } = await db.from("briefing_members").delete().eq("briefing_id", briefing_id);
      if (me) return NextResponse.json({ error: me.message }, { status: 200 });
      const { data, error } = await db.from("briefings").delete().eq("id", briefing_id).select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
      if (!data?.length) return NextResponse.json({ error: "briefing não encontrado (já apagado?)" }, { status: 200 });
      return NextResponse.json({ ok: true });
    }

    // criação — brief-first: nasce do pedido, sem membros
    const { name, caracterizacao = null, client = "loreal" } = body;
    if (!name?.trim()) return NextResponse.json({ error: "nome do briefing vazio" }, { status: 200 });
    const { data: briefing, error: be } = await db.from("briefings")
      .insert({ name: name.trim(), caracterizacao: caracterizacao?.trim() || null, client }).select("id").single();
    if (be) return NextResponse.json({ error: be.message }, { status: 200 });
    return NextResponse.json({ id: briefing.id });
  } catch (e) { return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 }); }
}
