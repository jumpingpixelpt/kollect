import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer as supabase } from "@/lib/supabase";
import { sessionRole, soMeus } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

// Links antigos com recortes da base continuam válidos no Hub.
const HUB_PARAMS = ["q", "tema", "n", "l", "p", "fw", "b", "sort", "dir", "cs", "sn", "ft"];

export default async function Creators(props) {
  const searchParams = await props.searchParams;
  if (HUB_PARAMS.some((k) => typeof searchParams[k] === "string" && searchParams[k])) {
    const query = new URLSearchParams();
    for (const k of [...HUB_PARAMS, "c", "cliente"]) if (typeof searchParams[k] === "string" && searchParams[k]) query.set(k, searchParams[k]);
    redirect(`/creators-hub?${query}`);
  }
  const query = new URLSearchParams();
  for (const k of ["cliente", "tipo"]) if (typeof searchParams[k] === "string" && searchParams[k]) query.set(k, searchParams[k]);
  const suffix = query.size ? `?${query}` : "";
  // A página da campanha valida veCampanha também quando o ID vem diretamente da URL.
  if (typeof searchParams.c === "string" && searchParams.c) redirect(`/campanha/${encodeURIComponent(searchParams.c)}${suffix}`);

  const { user, role } = await sessionRole();
  const { data, error } = await soMeus(supabase.from("campaigns").select("id"), user?.id, role === "admin")
    .order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  if (error) throw new Error("Não foi possível carregar o último briefing.");
  if (data) redirect(`/campanha/${data.id}${suffix}`);
  return (
    <div className="wrap">
      <section className="busca-head"><h1>Creators</h1><p>Os resultados do seu briefing aparecem aqui.</p></section>
      <div className="panel" style={{ padding: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Encontre os creators para a sua próxima ideia</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 24 }}>Gere um briefing na Busca para ver os requisitos atingidos por cada creator.</p>
        <Link href="/" className="gold-btn" style={{ display: "inline-flex", padding: "12px 20px" }}>Gerar briefing →</Link>
      </div>
    </div>
  );
}
