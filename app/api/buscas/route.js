import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionRole, veCampanha } from "@/lib/auth-server";
import { erroPublico } from "@/lib/erro-publico";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Histórico de buscas (feedback rodada 2, bug 2 — set/2026). Ver lib/buscas.js e a
 * migração supabase/migrations/202609210001_buscas.sql.
 *
 *  GET  ?id=                              → { busca } — para o "Retomar" da Busca reabrir o
 *                                           texto e os campos. Só o dono (ou um admin).
 *  POST { action: "aberto", campaign_id } → regista que o utilizador abriu o briefing agora
 *                                           ("Recentemente aberto por você", que vivia no
 *                                           localStorage e mudava de aparelho para aparelho).
 *
 * A linha de abertura é a busca do próprio utilizador ligada a essa campanha; se não houver
 * (briefing partilhado, legado, ou anterior à tabela), cria uma já 'confirmado', com o texto
 * do briefing — não aparece como "Não concluída" e serve só para ordenar.
 * Erros em HTTP 200 com { error } (convenção da app); sem sessão é 401, como o middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  try {
    const { user, role } = await sessionRole();
    if (!user) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !UUID.test(id)) return NextResponse.json({ error: "Busca não encontrada." });
    const { data: b, error } = await supabaseAdmin().from("buscas")
      .select("id, user_id, origem, texto, campos, estado, erro_codigo, campaign_id, created_at")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(`buscas: ${error.message}`);
    if (!b || (b.user_id !== user.id && role !== "admin")) return NextResponse.json({ error: "Busca não encontrada." });
    const { user_id, ...busca } = b;
    return NextResponse.json({ busca });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "buscas GET"), { status: 200 });
  }
}

export async function POST(req) {
  try {
    const { user, role } = await sessionRole();
    if (!user) return NextResponse.json({ error: "Sessão expirada. Entre de novo." }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (body.action !== "aberto") return NextResponse.json({ error: "Ação inválida." });
    const campaignId = String(body.campaign_id || "");
    if (!UUID.test(campaignId)) return NextResponse.json({ error: "Briefing não encontrado." });

    const db = supabaseAdmin();
    const { data: camp, error: ce } = await db.from("campaigns")
      .select("id, name, briefing, user_id, shared_with").eq("id", campaignId).maybeSingle();
    if (ce) throw new Error(`campaigns: ${ce.message}`);
    if (!veCampanha(camp, user.id, role === "admin")) return NextResponse.json({ error: "Briefing não encontrado." });

    const agora = new Date().toISOString();
    const { data: upd, error: ue } = await db.from("buscas")
      .update({ aberto_em: agora, updated_at: agora })
      .eq("user_id", user.id).eq("campaign_id", campaignId).select("id");
    if (ue) throw new Error(`buscas update: ${ue.message}`);
    if (upd?.length) return NextResponse.json({ ok: true, aberto_em: agora });

    const { error: ie } = await db.from("buscas").insert({
      user_id: user.id, origem: "busca", estado: "confirmado", campaign_id: campaignId,
      texto: String(camp.briefing || camp.name || "Briefing"), aberto_em: agora,
    });
    if (ie) throw new Error(`buscas insert: ${ie.message}`);
    return NextResponse.json({ ok: true, aberto_em: agora });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "buscas POST"), { status: 200 });
  }
}
