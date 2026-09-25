"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import CampaignDelete from "./CampaignDelete";

/**
 * Últimos briefings solicitados. Era uma grelha fixa dos 6 mais recentes ("Active
 * Briefings"): quem trabalha um briefing durante dias via-o a afundar à medida que
 * outros entravam. A ordenação por "aberto por você" resolve isso sem inventar dados:
 * por VOCÊ, não pela equipa. Sem histórico, cai na data.
 *
 * Feedback rodada 2, bug 2 (set/2026): as aberturas viviam no localStorage e mudavam de
 * browser para browser — para o cliente, "o histórico some". Passaram para o servidor
 * (buscas.aberto_em, POST /api/buscas action "aberto"); chegam em `items[].aberto_em`,
 * por isso a primeira renderização continua igual no servidor e no cliente. O clique
 * actualiza a ordem local de imediato e regista no servidor sem esperar.
 *
 * `pendentes`: as buscas de quem está a ver que não chegaram a briefing (leitura falhada
 * ou não confirmada, últimos 30 dias), em segundo plano visual, com "Retomar".
 */
const K_VISTA = "kollect:briefings-vista";

const ORDENS = [
  ["abertos", "Recentemente aberto por você"],
  ["recentes", "Mais recentes"],
  ["candidatos", "Mais candidatos"],
];

const fmtQuando = (d) => {
  try { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }); } catch { return ""; }
};

export default function UltimosBriefings({ items = [], pendentes = [] }) {
  const [ordem, setOrdem] = useState("abertos");
  const [vista, setVista] = useState("grid");
  const [abertos, setAbertos] = useState({});

  useEffect(() => {
    try {
      const v = localStorage.getItem(K_VISTA);
      if (v === "lista" || v === "grid") setVista(v);
    } catch { /* browser sem storage (privado, bloqueado): fica a ordem por data */ }
  }, []);

  const marcarAberto = (id) => {
    // Só a ordem local, na hora. O registo no servidor passou para a própria página do
    // briefing (components/BriefingContexto.js, F2.5), que conta qualquer entrada — dois
    // POSTs em paralelo podiam criar duas linhas de abertura para a mesma campanha.
    setAbertos((a) => ({ ...a, [id]: Date.now() }));
  };

  const trocarVista = (v) => {
    setVista(v);
    try { localStorage.setItem(K_VISTA, v); } catch { /* idem */ }
  };

  const ts = (x) => (x?.created_at ? new Date(x.created_at).getTime() : 0);
  const aberto = (x) => abertos[x.id] || (x?.aberto_em ? new Date(x.aberto_em).getTime() : 0);
  const ord = [...items].sort((a, b) => {
    if (ordem === "candidatos") return (b.total - a.total) || (ts(b) - ts(a));
    if (ordem === "abertos") return (aberto(b) - aberto(a)) || (ts(b) - ts(a));
    return ts(b) - ts(a);
  });

  // Secundário de propósito: é o que ficou a meio, não o trabalho do dia. <a> e não
  // <Link>: na própria Busca, um Link manteria o formulário montado e o ?retomar= não
  // seria lido; a navegação inteira reabre-o preenchido.
  const naoConcluidas = pendentes.length > 0 && (
    <div className="ub-pendentes" style={{ marginTop: items.length ? 22 : 0, opacity: 0.85 }}>
      <div className="filter-label" style={{ marginBottom: 6 }}>Buscas não concluídas</div>
      <div className="dlist">
        {pendentes.map((p) => (
          <div key={p.id} className="drow" style={{ padding: "8px 12px" }}>
            <div className="dinfo">
              <div className="dname" style={{ fontSize: 13 }}>{p.titulo}</div>
              <div className="dmeta">
                Não concluída{p.estado === "erro" ? " · a leitura não terminou" : " · falta confirmar"}{p.quando ? ` · ${fmtQuando(p.quando)}` : ""}
              </div>
            </div>
            <a href={`/?retomar=${p.id}`} style={{ color: "var(--gold-bright)", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", textDecoration: "none" }}>Retomar →</a>
          </div>
        ))}
      </div>
    </div>
  );

  if (!items.length) return (
    <>
      <div className="empty">Nenhum briefing ainda. Escreva um acima e a plataforma devolve o casting.</div>
      {naoConcluidas}
    </>
  );

  return (
    <>
      <div className="ub-bar">
        <div className="filter-select-wrap">
          <select className="filter-select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
            {ORDENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="filter-caret">▾</span>
        </div>
        <div className="ub-vista">
          <button className={`ub-vb${vista === "grid" ? " on" : ""}`} onClick={() => trocarVista("grid")} aria-label="Ver em grelha">▦</button>
          <button className={`ub-vb${vista === "lista" ? " on" : ""}`} onClick={() => trocarVista("lista")} aria-label="Ver em lista">≡</button>
        </div>
      </div>

      {vista === "grid" ? (
        <div className="brief-grid">
          {ord.map((cp) => (
            <div key={cp.id} className="brief-card-wrap" style={{ position: "relative" }}>
              <Link href={`/campanha/${cp.id}`} className="brief-card" onClick={() => marcarAberto(cp.id)}>
                <div className="brief-name" style={{ paddingRight: 30 }}>{cp.name}</div>
                {/* big numbers antes do texto (rodada 2): os três números lêem-se de longe */}
                <div className="brief-nums">
                  <span><b>{cp.total}</b>no match</span><span><b>{cp.kol}</b>KOLs</span><span><b>{cp.rising}</b>Rising</span>
                </div>
                <div className="brief-cta">Abrir casting →</div>
              </Link>
              <CampaignDelete campaignId={cp.id} name={cp.name} />
            </div>
          ))}
        </div>
      ) : (
        <div className="dlist">
          {ord.map((cp) => (
            <Link key={cp.id} href={`/campanha/${cp.id}`} className="drow" onClick={() => marcarAberto(cp.id)}
              style={{ textDecoration: "none", color: "inherit" }}>
              <div className="davatar davatar-empty">✦</div>
              <div className="dinfo">
                <div className="dname">{cp.name}</div>
                <div className="dmeta">{cp.total} no match · {cp.kol} KOLs · {cp.rising} Rising{cp.created_at ? ` · ${new Date(cp.created_at).toLocaleDateString("pt-BR")}` : ""}</div>
              </div>
              <div className="dscore"><div className="v">{cp.total}</div><div className="k">no match</div></div>
            </Link>
          ))}
        </div>
      )}
      {naoConcluidas}
    </>
  );
}
