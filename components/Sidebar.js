"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ClientSwitcher from "@/components/ClientSwitcher";
import UserBadge from "@/components/UserBadge";
import ThemeToggle from "@/components/ThemeToggle";
import KollectMark from "@/components/KollectMark";
import SnackWordmark from "@/components/SnackWordmark";
import { DEFAULT_CLIENT } from "@/lib/clients";

const fmtBadge = (n) =>
  n == null ? null : n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(".", ",") + "k" : String(Math.round(n));

const NAV = [
  { sec: "Plataforma" },
  { href: "/", label: "Busca", icon: "search", match: (p) => p === "/" },
  // Creators reúne os resultados do briefing; a pesquisa de nomes vive no Hub.
  { href: "/creators", label: "Creators", icon: "spark", match: (p) => p === "/creators" || p.startsWith("/campanha/") },
  // Termômetro fora do menu (set/2026): é uma leitura de cobertura do funil, interna, e não um
  // destino do fluxo de trabalho. A rota /termometro continua a existir e acessível por URL.
  // Briefings e Squad List sobem para "Plataforma" (set/2026): são o trabalho do dia a dia —
  // o pedido e as listas que dele saem — e não etapas do funil de captação.
  { href: "/listas", label: "Squad", icon: "squad", match: (p) => p.startsWith("/listas") },
  { href: "/campanha", label: "Histórico", icon: "history", match: (p) => p === "/campanha" },
  { href: "/creators-hub", label: "Creators Hub", icon: "hub", match: (p) => p === "/creators-hub" || p.startsWith("/creator/") },
  // Configurações fecha a Plataforma e não a Gestão: reúne aparência, cliente e sessão,
  // que o operador também usa. Pô-la depois do cabeçalho "Gestão" arrumava-a numa
  // secção de admins a que ela não pertence.
  { href: "/configuracoes", label: "Configurações", icon: "settings", match: (p) => p.startsWith("/configuracoes") },
  // Gestão é só de admins (decisão do cliente, ago/2026): o operador usa a plataforma,
  // não configura o que ela analisa. As páginas fazem o gate por papel — isto tira-as do
  // menu, para não haver portas visíveis que levam a um redirect.
  { sec: "Gestão", admin: true },
  // Descobertas vive na Gestão (set/2026): alimentar a base é operação da casa, não
  // trabalho do cliente. Teve secção própria, "Funil", que só tinha este item — uma
  // secção de um só link é um cabeçalho a mais.
  { href: "/descobertas", label: "Descobertas", icon: "discovery", badge: "prospects", match: (p) => p.startsWith("/descobertas"), admin: true },
  // "Análise de dados" e não "Briefings": o cliente usa a palavra briefing para o documento
  // da campanha — e é esse o rótulo de /campanha desde set/2026. Aqui a área é outra: onde se
  // caracteriza o pedido e se lê a resposta do universo, por isso mantém nome próprio.
  { href: "/briefings", label: "Análise de dados", icon: "analysis", badge: "briefings", match: (p) => p.startsWith("/briefings"), admin: true },
  { href: "/admin", label: "Usuários", icon: "users", match: (p) => p.startsWith("/admin"), admin: true },
];

function NavIcon({ name }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    spark: <path d="M12 2c1.2 6.2 3.8 8.8 10 10-6.2 1.2-8.8 3.8-10 10-1.2-6.2-3.8-8.8-10-10 6.2-1.2 8.8-3.8 10-10Z" />,
    squad: <><circle cx="9" cy="7.5" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2H3ZM16 4.6a3 3 0 0 1 0 5.8M18 13a5 5 0 0 1 3 4.6V20h-3" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
    hub: <><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="18" rx="1.5" /><path d="M6 7h1M17 7h1M6 17h1M17 17h1" /></>,
    settings: <><path d="m9 3-.6 2-2 .9-2-.5-2 3.4L4 10.3v3.4l-1.6 1.5 2 3.4 2-.5 2 .9.6 2h4l.6-2 2-.9 2 .5 2-3.4-1.6-1.5v-3.4l1.6-1.5-2-3.4-2 .5-2-.9L13 3H9Z" /><circle cx="11" cy="12" r="3" /></>,
    discovery: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" /></>,
    analysis: <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4" /></>,
    users: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export default function Sidebar({ prospects, campaigns, creators, briefings, lists, isAdmin = false, email = "" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sideRef = useRef(null);
  const menuRef = useRef(null);
  const nav = NAV.filter((item) => !item.admin || isAdmin);
  const badges = { prospects: fmtBadge(prospects), campaigns: fmtBadge(campaigns), creators: fmtBadge(creators), briefings: fmtBadge(briefings), lists: fmtBadge(lists) };
  // Sem useSearchParams aqui: forçaria bailout de SSR no layout inteiro. Com um
  // cliente só o valor é ignorado; com 2+, o ClientSwitcher troca via URL na mesma.
  const current = DEFAULT_CLIENT;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sideRef.current?.querySelector(".side-close")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const focusable = [...(sideRef.current?.querySelectorAll('a[href], button:not([disabled]), select:not([disabled])') || [])]
        .filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const onResize = () => { if (window.innerWidth > 920) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      menuRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <div className="app-backdrop" aria-hidden="true" />
      <div className="mbar">
        <span className="mb-brand">
          <KollectMark size={30} /> KOLLECT
        </span>
        <button ref={menuRef} type="button" className="mburger" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open} aria-controls="app-sidebar"><NavIcon name="menu" /> Menu</button>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside ref={sideRef} id="app-sidebar" className={`side${open ? " open" : ""}`} aria-label="Menu da plataforma">
        <button type="button" className="side-close" onClick={() => setOpen(false)} aria-label="Fechar menu"><NavIcon name="close" /></button>
        <Link href="/" className="side-brand" aria-label="KOLLECT — início">
          <KollectMark size={40} />
          <div>
            <div className="bn">KOLLECT</div>
            <SnackWordmark className="bs" />
          </div>
        </Link>

        <nav aria-label="Navegação principal">
          {nav.map((item, i) =>
            item.sec ? (
              <div key={i} className="nav-sec">{item.sec}</div>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${item.match(pathname) ? " on" : ""}`}
                aria-current={item.match(pathname) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="glyph"><NavIcon name={item.icon} /></span> <span>{item.label}</span>
                {item.note && <span className="nav-note">{item.note}</span>}
                {item.badge && badges[item.badge] && <b className="nav-badge">{badges[item.badge]}</b>}
              </Link>
            )
          )}
        </nav>

        <div className="side-foot">
          <div className="side-manifesto">
            <span className="side-spark" aria-hidden="true">✦</span>
            <p>Mais conexões.<br />Mais resultados.</p>
            <span className="side-signature" aria-hidden="true" />
          </div>
          <div className="client-pick">
            <span className="lbl">Cliente</span>
            <ClientSwitcher current={current} />
          </div>
          <div className="client-pick">
            <span className="lbl">Aparência</span>
            <ThemeToggle />
          </div>
          <UserBadge email={email} />
        </div>
      </aside>
    </>
  );
}
