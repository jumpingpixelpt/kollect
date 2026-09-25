"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CreatorResultRow, { CabecalhoResultados, CorpoResultado, CorpoEsqueleto } from "@/components/CreatorResultRow";
import SelecaoCreators, { MarcarCreator } from "@/components/SelecaoCreators";
import AddToList from "@/components/AddToList";
import CampaignStatus from "@/components/CampaignStatus";
import CampaignRemove from "@/components/CampaignRemove";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Lista de Creators de um briefing, 20 a 20 (pedido do Rui, 22/09/2026).
 *
 * Medido em produção: a página mandava as ~150 linhas com o card aberto inteiro, fechado ou
 * não — 3,6 MB de HTML. Agora o servidor desenha o RESUMO das primeiras 20 (ou até à linha
 * de ?aberto=), e aqui:
 *  - «Carregar mais 20» no fim, com "20 de 145" — pede /api/campanha-linhas com os mesmos
 *    filtros (tipo, q); também carrega sozinho quando o botão entra no ecrã
 *    (IntersectionObserver). O botão fica como caminho acessível e para repetir após erro.
 *  - O card de cada linha vem de /api/campanha-card na primeira abertura, com um esqueleto
 *    enquanto chega, e fica guardado (fechar e reabrir não volta a pedir).
 *  - A seleção (components/SelecaoCreators.js) cobre as linhas carregadas.
 * Filtros, ordem e números vêm todos de lib/casting-linhas.js, como na primeira página.
 */
const btn = { fontSize: 12.5, padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--card)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };
const handleDe = (c) => String(c.handle || c.name || "Creator").replace(/^@/, "");

export default function ListaCasting({ campaignId, client, squad = null, total: totalInicial, iniciais = [], cardsIniciais = {}, abertoId = null, tipo = null, q = "", porPagina = 20 }) {
  const [linhas, setLinhas] = useState(iniciais);
  const [total, setTotal] = useState(totalInicial);
  const [cards, setCards] = useState(() => Object.fromEntries(Object.entries(cardsIniciais).map(([id, card]) => [id, { estado: "ok", card }])));
  const [aCarregar, setACarregar] = useState(false);
  const [erro, setErro] = useState(null);
  const pedidos = useRef(new Set(Object.keys(cardsIniciais)));
  const ocupado = useRef(false);
  const fim = useRef(null);

  const faltam = Math.max(0, total - linhas.length);

  const carregarMais = useCallback(async () => {
    if (ocupado.current || faltam <= 0) return;
    ocupado.current = true; setACarregar(true); setErro(null);
    try {
      const qs = new URLSearchParams({ id: campaignId, offset: String(linhas.length), limit: String(porPagina) });
      if (tipo) qs.set("tipo", tipo);
      if (q) qs.set("q", q);
      const j = await fetch(`/api/campanha-linhas?${qs}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!j || j.error || j.fatal || !Array.isArray(j.linhas)) {
        setErro(mensagemErro(j, "Não foi possível carregar mais creators. Tente de novo."));
        return;
      }
      const vistas = new Set(linhas.map((l) => l.rowId));
      const novas = j.linhas.filter((l) => !vistas.has(l.rowId));
      setLinhas([...linhas, ...novas]);
      // o casting pode ter mudado entretanto (outra aba removeu nomes): sem linhas novas, o
      // total passa a ser o que já está à vista, para o carregamento automático não girar
      setTotal(novas.length ? (Number.isInteger(j.total) ? j.total : total) : linhas.length);
    } catch {
      setErro("Falha de ligação. Verifique a rede e tente de novo.");
    } finally {
      ocupado.current = false; setACarregar(false);
    }
  }, [campaignId, linhas.length, porPagina, tipo, q, faltam, total]);

  const pedirCard = useCallback(async (creatorId) => {
    if (pedidos.current.has(creatorId)) return;
    pedidos.current.add(creatorId);
    setCards((c) => ({ ...c, [creatorId]: { estado: "carregando" } }));
    const falhou = (texto) => {
      pedidos.current.delete(creatorId); // reabrir ou «Tentar de novo» volta a pedir
      setCards((c) => ({ ...c, [creatorId]: { estado: "erro", erro: texto } }));
    };
    try {
      const j = await fetch(`/api/campanha-card?id=${encodeURIComponent(campaignId)}&creator=${encodeURIComponent(creatorId)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!j?.card) return falhou(mensagemErro(j, "Não foi possível carregar os dados desta creator. Tente de novo."));
      setCards((c) => ({ ...c, [creatorId]: { estado: "ok", card: j.card } }));
    } catch {
      falhou("Falha de ligação. Verifique a rede e tente de novo.");
    }
  }, [campaignId]);

  // ?aberto= sem card vindo do servidor: o <details> já nasce aberto e o toggle do parse
  // chega antes da hidratação — pede-se aqui
  useEffect(() => {
    if (abertoId && linhas.some((l) => l.creator.id === abertoId)) pedirCard(abertoId);
    // só na montagem: depois, quem pede é o toggle
  }, []);

  // carregamento automático quando o fim da lista se aproxima; parado depois de um erro
  useEffect(() => {
    const el = fim.current;
    if (!el || faltam <= 0 || erro || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) carregarMais(); }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [carregarMais, faltam, erro]);

  const ids = linhas.map((l) => l.creator.id);
  const nomes = Object.fromEntries(linhas.map((l) => [l.creator.id, l.creator.name || `@${l.creator.handle}`]));

  const corpoDe = (c) => {
    const st = cards[c.id];
    if (!st) return null; // ainda nunca aberta: nada no DOM além do summary
    if (st.estado !== "ok") return <CorpoEsqueleto erro={st.estado === "erro" ? st.erro : null} onRepetir={() => pedirCard(c.id)} />;
    const k = st.card;
    return (
      <CorpoResultado handle={handleDe(c)} avaliacao={k.avaliacao}
        numeros={k.numeros.map((n) => (n.subCor !== undefined && n.sub ? { ...n, sub: <span style={n.subCor ? { color: n.subCor } : undefined}>{n.sub}</span> } : n))}
        metricasRede={k.metricasRede} redeForte={k.redeForte || []} justificativa={k.justificativa} contas={k.contas}
        acoes={<>
          <Link className="chip" href={`/creator/${c.id}?cliente=${client}&camp=${campaignId}`}>Ver ficha completa →</Link>
          <AddToList creatorId={c.id} nome={k.nome || k.handle} compacto sugerida={squad} />
          <CampaignStatus rowId={k.rowId} status={k.status} />
          <CampaignRemove rowId={k.rowId} nome={k.nome} />
        </>}>
        {(k.avisos || []).map((a) => (
          <p key={a.tipo} style={{ color: a.tipo === "alto" ? "var(--red)" : "var(--gold-bright)", fontSize: 12, marginTop: 8 }}>{a.texto}</p>
        ))}
      </CorpoResultado>
    );
  };

  return (
    <SelecaoCreators campaignId={campaignId} client={client} squad={squad} ids={ids} nomes={nomes}
      rotuloTodos={linhas.length < total ? "Selecionar os carregados" : "Selecionar todos os visíveis"}>
      <CabecalhoResultados ordem="Ordenado por aderência ao briefing" />
      {linhas.map((l) => {
        const c = l.creator;
        return (
          <CreatorResultRow key={l.rowId} creator={c} avaliacao={l.avaliacao} tag={l.tag} reference={l.reference}
            colunas={l.colunas} aberto={abertoId === c.id}
            selecao={<MarcarCreator id={c.id} nome={c.name || c.handle} />}
            corpo={corpoDe(c)}
            onToggle={(e) => { if (e.currentTarget.open && cards[c.id]?.estado !== "ok") pedirCard(c.id); }} />
        );
      })}
      {total > porPagina || faltam > 0 ? (
        <div ref={fim} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 16, fontSize: 12.5, color: "var(--text-dim)" }}>
          <span aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>
            <b style={{ color: "var(--text)" }}>{linhas.length}</b> de {total} creators
          </span>
          {faltam > 0 && (
            <button type="button" style={btn} onClick={carregarMais} disabled={aCarregar} aria-busy={aCarregar || undefined}>
              {aCarregar ? "A carregar…" : `Carregar mais ${Math.min(porPagina, faltam)}`}
            </button>
          )}
          {erro && <span role="alert" style={{ color: "var(--red)" }}>{erro}</span>}
        </div>
      ) : null}
    </SelecaoCreators>
  );
}
