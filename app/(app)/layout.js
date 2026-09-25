import Sidebar from "@/components/Sidebar";
import FundoParticulas from "@/components/FundoParticulas";
import { unstable_cache } from "next/cache";
import { supabaseServer as supabase } from "@/lib/supabase";
import { SUPABASE_URL } from "@/lib/auth";
import { sessionRole } from "@/lib/auth-server";
import { createSidebarCountLoader } from "@/lib/sidebar-counts";

// O papel é lido por sessão, portanto o shell não pode ser servido de cache partilhada:
// com revalidate, um operador podia receber a sidebar montada para um admin.
export const revalidate = 0;

const sidebarCounts = createSidebarCountLoader({
  db: supabase, cache: unstable_cache, cacheKey: SUPABASE_URL,
});

// Shell autenticado: sidebar fixa + conteúdo. O /login vive fora deste grupo.
export default async function AppLayout({ children }) {
  // Sessão e contagens em paralelo (B3.2): as contagens são globais e em cache; só chegam
  // à Sidebar quando o papel é admin (os dois badges são da Gestão).
  const [{ user, role }, counts] = await Promise.all([sessionRole(), sidebarCounts()]);
  const isAdmin = role === "admin";

  return (
    <div className="shell">
      <FundoParticulas />
      <Sidebar {...(isAdmin ? counts : {})} isAdmin={isAdmin} email={user?.email || ""} />
      <main className="mainpane">{children}</main>
    </div>
  );
}
