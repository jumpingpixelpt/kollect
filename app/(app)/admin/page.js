import { redirect } from "next/navigation";
import { sessionRole } from "@/lib/auth-server";
import AdminUsers from "@/components/AdminUsers";

export const dynamic = "force-dynamic";

// Gestão de utilizadores — só admins (gate aqui, não no middleware: o middleware
// garante sessão; o papel decide-se por página). Operador que entre é reenviado ao radar.
export default async function Admin() {
  const { user, role } = await sessionRole();
  if (!user || role !== "admin") redirect("/");

  return (
    <div className="wrap">
      <section className="hero" style={{ padding: "44px 0 22px" }}>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Gestão de <em>utilizadores</em></h1>
        <p>
          Contas de acesso à plataforma. Os <strong>signups públicos estão desligados</strong> — novas contas
          criam-se só por aqui, e cada uma entra como <em>admin</em> (gere utilizadores) ou <em>operador</em> (usa a plataforma).
        </p>
      </section>
      <AdminUsers />
    </div>
  );
}
