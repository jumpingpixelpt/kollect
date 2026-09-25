import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionRole } from "@/lib/auth-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gestão de utilizadores (plano L'Oréal, Onda 3) — apenas admins, sessão via cookie.
 *  GET               → lista utilizadores + papel + estado
 *  POST {email, password, papel}          → cria utilizador (email já confirmado;
 *                                           signups públicos continuam desligados)
 *  PATCH {user_id, acao[, papel]}         → desativar | reativar | papel
 *  PATCH {user_id, acao:"password", password}   → define uma palavra-passe nova (admin entrega-a)
 *  PATCH {user_id, acao:"link_recuperacao"}     → link de 1 hora para a pessoa definir a sua
 *
 * RECUPERAÇÃO SEM SMTP (set/2026): o projeto Supabase não tem SMTP próprio — o sender embutido
 * só entrega a membros do projeto e a 2 e-mails/hora. Por isso o link de recuperação nasce
 * aqui, pela mão do admin: `generateLink` devolve o token, e a página /recuperar troca-o por
 * sessão com `verifyOtp` sem passar por e-mail nenhum. O admin entrega o link por um canal
 * seguro (WhatsApp, Teams). Quem tem o link define a password nessa hora — é o mesmo poder de
 * um e-mail de recuperação, e por isso o link nunca fica guardado.
 * Erros em HTTP 200 com {error} (convenção da app).
 */
async function gate() {
  const { user, role } = await sessionRole();
  if (!user) return { err: "sem sessão" };
  if (role !== "admin") return { err: "apenas admins podem gerir utilizadores" };
  return { user };
}

const ativo = (u) => !(u.banned_until && new Date(u.banned_until) > new Date());

export async function GET() {
  try {
    const g = await gate();
    if (g.err) return NextResponse.json({ error: g.err }, { status: 200 });
    const db = supabaseAdmin();
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    const { data: roles } = await db.from("user_roles").select("user_id, role");
    const roleBy = Object.fromEntries((roles ?? []).map((r) => [r.user_id, r.role]));
    const users = (data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      papel: roleBy[u.id] ?? "operador",
      ativo: ativo(u),
      ultimo_login: u.last_sign_in_at ?? null,
      criado_em: u.created_at ?? null,
    }));
    return NextResponse.json({ users, eu: g.user.id });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

export async function POST(req) {
  try {
    const g = await gate();
    if (g.err) return NextResponse.json({ error: g.err }, { status: 200 });
    const { email, password, papel } = await req.json();
    if (!email?.includes("@")) return NextResponse.json({ error: "email inválido" }, { status: 200 });
    if (!password || password.length < 8) return NextResponse.json({ error: "password com pelo menos 8 caracteres" }, { status: 200 });
    const role = papel === "admin" ? "admin" : "operador";
    const db = supabaseAdmin();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    const { error: re } = await db.from("user_roles").upsert({ user_id: data.user.id, role });
    return NextResponse.json({ ok: true, id: data.user.id, papel: role, roleErr: re?.message ?? null });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

export async function PATCH(req) {
  try {
    const g = await gate();
    if (g.err) return NextResponse.json({ error: g.err }, { status: 200 });
    const body = await req.json();
    const { user_id, acao, papel } = body;
    if (!user_id) return NextResponse.json({ error: "user_id obrigatório" }, { status: 200 });
    // auto-lockout: um admin não se desativa nem se despromove a si próprio
    if (user_id === g.user.id && (acao === "desativar" || (acao === "papel" && papel !== "admin")))
      return NextResponse.json({ error: "não podes desativar ou despromover a tua própria conta" }, { status: 200 });
    const db = supabaseAdmin();
    if (acao === "desativar") {
      const { error } = await db.auth.admin.updateUserById(user_id, { ban_duration: "87600h" });
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    } else if (acao === "reativar") {
      const { error } = await db.auth.admin.updateUserById(user_id, { ban_duration: "none" });
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    } else if (acao === "papel") {
      const role = papel === "admin" ? "admin" : "operador";
      const { error } = await db.from("user_roles").upsert({ user_id, role });
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    } else if (acao === "password") {
      const { password } = body;
      if (!password || password.length < 8) return NextResponse.json({ error: "password com pelo menos 8 caracteres" }, { status: 200 });
      const { error } = await db.auth.admin.updateUserById(user_id, { password });
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    } else if (acao === "link_recuperacao") {
      const { data: alvo, error: ue } = await db.auth.admin.getUserById(user_id);
      if (ue || !alvo?.user?.email) return NextResponse.json({ error: ue?.message || "utilizador sem e-mail" }, { status: 200 });
      const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: alvo.user.email });
      if (error) return NextResponse.json({ error: error.message }, { status: 200 });
      const hash = data?.properties?.hashed_token;
      if (!hash) return NextResponse.json({ error: "o Supabase não devolveu o token do link" }, { status: 200 });
      // a origem do pedido: em produção www.kollect.online, em dev localhost — o link tem de
      // abrir na mesma app que o gerou
      const origem = new URL(req.url).origin;
      return NextResponse.json({ ok: true, link: `${origem}/recuperar?token_hash=${encodeURIComponent(hash)}&type=recovery`, email: alvo.user.email, valido_min: 60 });
    } else {
      return NextResponse.json({ error: "acao inválida — desativar | reativar | papel | password | link_recuperacao" }, { status: 200 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
