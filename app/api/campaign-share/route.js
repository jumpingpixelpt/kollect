import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionRole, mandaNaCampanha } from "@/lib/auth-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Partilha de um briefing com colegas (pedido de 03/09/2026).
 *
 * Os briefings são individuais desde set/2026 (soMeus em lib/auth-server.js). Isto abre a
 * excepção controlada: o DONO escolhe com quem partilha, e quem é escolhido passa a vê-lo
 * em todo o lado — sem ganhar o direito de o apagar nem de o voltar a partilhar.
 *
 *  GET  ?campaign_id=             → { dono, dono_email, legado, shared_with, utilizadores, eu }
 *  POST {campaign_id, user_ids[]} → substitui o conjunto inteiro (é o que o painel envia)
 *
 * Só o dono ou um admin. A lista de utilizadores vem da auth admin API (não há tabela de
 * perfis) e só expõe id + email de contas activas: é o mínimo para escolher um colega.
 *
 * SÓ OPERADORES entram na lista (03/09/2026, "não faz sentido partilhar com admin visto
 * que este perfil tem acesso total"): o admin já vê todos os briefings pelo soMeus, portanto
 * partilhar com ele não muda nada — só encheria a lista. O papel vem de user_roles; quem
 * não tem linha é operador, como em lib/auth-server.js. O POST descarta admins pela mesma
 * razão, mesmo que o corpo os traga.
 * Erros em HTTP 200 com {error} (convenção da app); sem sessão é 401, como o middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ativo = (u) => !(u.banned_until && new Date(u.banned_until) > new Date());

async function abrir(campaignId) {
  const { user, role } = await sessionRole();
  if (!user) return { err: "sem sessão", status: 401 };
  if (!campaignId || !UUID.test(campaignId)) return { err: "campaign_id obrigatório" };
  const db = supabaseAdmin();
  const { data: camp } = await db.from("campaigns").select("id, name, user_id, shared_with").eq("id", campaignId).maybeSingle();
  if (!camp) return { err: "briefing não encontrado" };
  if (!mandaNaCampanha(camp, user.id, role === "admin")) return { err: "só o dono do briefing (ou um admin) pode gerir a partilha" };
  return { user, db, camp };
}

async function utilizadores(db) {
  const [{ data, error }, { data: roles }] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
    db.from("user_roles").select("user_id, role"),
  ]);
  if (error) throw new Error(error.message);
  const admins = new Set((roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id));
  return (data?.users ?? []).filter(ativo).filter((u) => !admins.has(u.id)).map((u) => ({ id: u.id, email: u.email || "" }));
}

export async function GET(req) {
  try {
    const g = await abrir(new URL(req.url).searchParams.get("campaign_id"));
    if (g.err) return NextResponse.json({ error: g.err }, { status: g.status ?? 200 });
    const todos = await utilizadores(g.db);
    return NextResponse.json({
      dono: g.camp.user_id,
      legado: g.camp.user_id == null,
      shared_with: g.camp.shared_with ?? [],
      // o dono não se partilha a si próprio; a ordem alfabética torna a lista previsível.
      // Se o dono for admin já não está em `todos` — o filtro é inócuo nesse caso.
      utilizadores: todos.filter((u) => u.id !== g.camp.user_id).sort((a, b) => a.email.localeCompare(b.email)),
      eu: g.user.id,
    });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const g = await abrir(body?.campaign_id);
    if (g.err) return NextResponse.json({ error: g.err }, { status: g.status ?? 200 });
    if (g.camp.user_id == null) return NextResponse.json({ error: "briefing do regime antigo: já é visível a toda a equipa" }, { status: 200 });
    if (!Array.isArray(body.user_ids)) return NextResponse.json({ error: "user_ids deve ser uma lista" }, { status: 200 });
    // só ids que existem mesmo e são operadores: um id inventado não fica guardado, e um
    // admin também não — já vê tudo
    const conhecidos = new Set((await utilizadores(g.db)).map((u) => u.id));
    const shared_with = [...new Set(body.user_ids.filter((x) => typeof x === "string" && UUID.test(x)))]
      .filter((x) => x !== g.camp.user_id && conhecidos.has(x));
    const { error } = await g.db.from("campaigns").update({ shared_with }).eq("id", g.camp.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true, shared_with });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
