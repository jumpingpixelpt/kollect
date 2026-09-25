import ThemeToggle from "@/components/ThemeToggle";
import ClientSwitcher from "@/components/ClientSwitcher";
import LogoutButton from "@/components/LogoutButton";
import { sessionRole } from "@/lib/auth-server";
import { CLIENTS, DEFAULT_CLIENT, clientLabel } from "@/lib/clients";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * CONFIGURAÇÕES — o destino que os direcionais desenham na navegação (slides 4, 7, 8, 12).
 *
 * Reúne o que já existia disperso pelo rodapé da sidebar: aparência, cliente activo e
 * sessão. NÃO inventa preferências novas: uma página de definições que oferece opções sem
 * efeito é pior do que não existir, porque quem as muda fica à espera de uma mudança que
 * não vem. Cada linha aqui liga a um controlo que já funciona.
 *
 * O que é só leitura — o papel, o número de clientes — aparece como facto, não como campo,
 * para não sugerir que se muda daqui. Papéis mudam em /admin, que é de admins.
 */
export default async function Configuracoes() {
  const { user, role } = await sessionRole();
  const isAdmin = role === "admin";

  return (
    <div className="wrap">
      <section className="hero" style={{ padding: "30px 0 18px" }}>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Configurações</h1>
        <p>As definições desta sessão. O que não está aqui é porque ainda não tem efeito — e uma opção sem efeito é pior do que a ausência dela.</p>
      </section>

      <div className="cfg">
        <div className="cfg-row">
          <div className="cfg-t">
            <b>Aparência</b>
            <span>Escuro por omissão. A escolha fica guardada neste navegador e acompanha as outras abas abertas — não é uma definição da conta.</span>
          </div>
          <div className="cfg-c"><ThemeToggle /></div>
        </div>

        <div className="cfg-row">
          <div className="cfg-t">
            <b>Cliente activo</b>
            <span>
              {CLIENTS.length < 2
                ? `Só há um cliente configurado (${clientLabel(DEFAULT_CLIENT)}). Activar outro é um passo de código — lib/clients.js documenta-o no cabeçalho.`
                : "Define a marca sobre a qual o radar e os briefings são lidos. A troca vai no endereço, portanto um link partilhado leva o cliente consigo."}
            </span>
          </div>
          <div className="cfg-c"><ClientSwitcher current={DEFAULT_CLIENT} /></div>
        </div>

        <div className="cfg-row">
          <div className="cfg-t">
            <b>Conta</b>
            <span>{user?.email || "—"} · {isAdmin ? "administrador" : "operador"}. O papel é atribuído por um administrador e não se muda daqui.</span>
          </div>
          <div className="cfg-c"><LogoutButton /></div>
        </div>

        {isAdmin && (
          <div className="cfg-row">
            <div className="cfg-t">
              <b>Utilizadores</b>
              <span>Criar contas e atribuir papéis. Os registos públicos estão desligados no projecto — contas novas são criadas por um administrador.</span>
            </div>
            <div className="cfg-c"><a className="chip" href="/admin">Abrir /admin</a></div>
          </div>
        )}
      </div>

      <footer className="footer" style={{ marginTop: 36 }}>
        <span>KOLLECT by Snack</span>
        <span>Definições desta sessão</span>
      </footer>
    </div>
  );
}
