"use client";
import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Seleção de creators na lista de resultados do briefing (feedback rodada 2, F1.6).
 *
 * A página é um componente de servidor que desenha cada linha como <details>; este invólucro
 * guarda a seleção num contexto e as caixas (MarcarCreator) vivem dentro do <summary> de
 * cada linha. Clicar na caixa não pode abrir/fechar o card: a caixa é um <button
 * role="checkbox"> com preventDefault — um <input type=checkbox> controlado com
 * preventDefault volta ao estado anterior depois de o React pintar (bug conhecido), e sem
 * preventDefault o clique chegava ao <summary>.
 *
 * Barra fixa com ≥ 1 selecionado: «Adicionar ao squad deste briefing» (a lista com
 * lists.campaign_id = este briefing, criada pelo /api/campaign), «Novo squad com a seleção»
 * (nome num campo inline, sem window.prompt) e «Ir para o squad →». Tudo pelo /api/lists
 * (add_items / criação), que já ignora duplicados. O «＋ Squad» de cada linha mantém-se.
 */
const Ctx = createContext(null);

// `rotuloTodos`: com a lista paginada (components/ListaCasting.js) «todos» são as linhas já
// carregadas, e o rótulo di-lo ("Selecionar os carregados").
export default function SelecaoCreators({ ids = [], nomes = {}, squad = null, campaignId, client = "loreal", rotuloTodos = "Selecionar todos os visíveis", children }) {
  const [sel, setSel] = useState(() => new Set());
  const [modoNovo, setModoNovo] = useState(false);
  const [nome, setNome] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo: "ok" | "erro", texto, link? }
  const [squadAtual, setSquadAtual] = useState(squad);

  const visiveis = useMemo(() => new Set(ids), [ids]);
  const marcados = [...sel].filter((id) => visiveis.has(id));
  const todos = ids.length > 0 && marcados.length === ids.length;

  const ctx = useMemo(() => ({
    marcado: (id) => sel.has(id),
    alternar: (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
  }), [sel]);

  function alternarTodos() {
    setSel((s) => {
      const n = new Set(s);
      if (todos) ids.forEach((id) => n.delete(id)); else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  async function enviar(body) {
    const r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  }

  async function adicionarAoSquad() {
    if (!squadAtual || aGravar || !marcados.length) return;
    setAGravar(true); setAviso(null);
    try {
      const d = await enviar({ action: "add_items", list_id: squadAtual.id, items: marcados.map((creator_id) => ({ creator_id })) });
      if (d.error) return setAviso({ tipo: "erro", texto: mensagemErro(d, "Não foi possível adicionar ao squad. Tente de novo.") });
      const n = Number.isInteger(d.added) ? d.added : marcados.length;
      const ja = marcados.length - n;
      setAviso({ tipo: "ok", texto: `${n} ${n === 1 ? "creator adicionado" : "creators adicionados"} a ${squadAtual.name}${ja > 0 ? ` · ${ja} já ${ja === 1 ? "estava" : "estavam"} no squad` : ""}.`, link: squadAtual.id });
      setSel(new Set());
    } catch { setAviso({ tipo: "erro", texto: "Falha de ligação. Verifique a rede e tente de novo." }); }
    finally { setAGravar(false); }
  }

  async function criarSquad(e) {
    e?.preventDefault();
    const n = nome.trim();
    if (!n) return setAviso({ tipo: "erro", texto: "Dê um nome ao squad." });
    if (aGravar || !marcados.length) return;
    setAGravar(true); setAviso(null);
    try {
      // sem squad ligado ao briefing, o novo passa a sê-lo (lists.campaign_id), como o que o
      // /api/campaign cria; com squad ligado, o novo é independente
      const d = await enviar({ name: n, client, ...(squadAtual ? {} : { campaign_id: campaignId }), items: marcados.map((creator_id) => ({ creator_id })) });
      if (!d.id) return setAviso({ tipo: "erro", texto: mensagemErro(d, "Não foi possível criar o squad. Tente de novo.") });
      if (d.error) setAviso({ tipo: "erro", texto: mensagemErro(d), link: d.id });
      else setAviso({ tipo: "ok", texto: `Squad «${n}» criado com ${marcados.length} ${marcados.length === 1 ? "creator" : "creators"}.`, link: d.id });
      if (!squadAtual && campaignId) setSquadAtual({ id: d.id, name: n });
      setSel(new Set()); setModoNovo(false); setNome("");
    } catch { setAviso({ tipo: "erro", texto: "Falha de ligação. Verifique a rede e tente de novo." }); }
    finally { setAGravar(false); }
  }

  const btn = { fontSize: 12.5, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--card)", color: "var(--text)", cursor: "pointer", whiteSpace: "nowrap" };
  const primario = { ...btn, borderColor: "var(--neon-a, var(--gold))", color: "var(--text)", boxShadow: "0 0 14px var(--neon-glow-soft, transparent)" };
  const nomesSel = marcados.slice(0, 3).map((id) => nomes[id]).filter(Boolean);

  return (
    <Ctx.Provider value={ctx}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "0 0 10px" }}>
        <button type="button" role="checkbox" aria-checked={todos ? "true" : marcados.length ? "mixed" : "false"}
          onClick={alternarTodos} disabled={!ids.length}
          style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", fontSize: 12 }}>
          <Caixa marcado={todos} parcial={!todos && marcados.length > 0} />
          {rotuloTodos} <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{ids.length}</span>
        </button>
        {marcados.length > 0 && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{marcados.length} {marcados.length === 1 ? "selecionado" : "selecionados"}</span>}
      </div>

      {children}

      {(marcados.length > 0 || aviso) && (
        <div role="region" aria-label="Ações da seleção" style={{
          position: "sticky", bottom: 12, zIndex: 20, marginTop: 14,
          background: "var(--bg-soft, var(--card))", border: "1px solid var(--neon-a, var(--line-strong))", borderRadius: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,.35), 0 0 22px var(--neon-glow-soft, transparent)",
          padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10,
        }}>
          {marcados.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {marcados.length} {marcados.length === 1 ? "creator" : "creators"}
                {nomesSel.length ? <span style={{ fontWeight: 400, color: "var(--text-faint)" }}> · {nomesSel.join(", ")}{marcados.length > nomesSel.length ? "…" : ""}</span> : null}
              </span>
              <span style={{ flex: 1 }} />
              {squadAtual
                ? <button type="button" style={primario} onClick={adicionarAoSquad} disabled={aGravar}>{aGravar && !modoNovo ? "A adicionar…" : "Adicionar ao squad deste briefing"}</button>
                : null}
              {!modoNovo
                ? <button type="button" style={btn} onClick={() => { setModoNovo(true); setAviso(null); }} disabled={aGravar}>Novo squad com a seleção</button>
                : (
                  <form onSubmit={criarSquad} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={200} placeholder="Nome do squad" aria-label="Nome do novo squad"
                      style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--bg)", color: "var(--text)", minWidth: 180 }} />
                    <button type="submit" style={primario} disabled={aGravar}>{aGravar ? "A criar…" : "Criar"}</button>
                    <button type="button" style={btn} onClick={() => { setModoNovo(false); setNome(""); }} aria-label="Cancelar novo squad">✕</button>
                  </form>
                )}
              {squadAtual ? <Link href={`/listas?id=${squadAtual.id}`} style={{ ...btn, textDecoration: "none" }}>Ir para o squad →</Link> : null}
              <button type="button" style={{ ...btn, border: "none", background: "none", color: "var(--text-dim)" }} onClick={() => setSel(new Set())}>Limpar seleção</button>
            </div>
          )}
          {aviso && (
            <div role={aviso.tipo === "erro" ? "alert" : "status"} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, color: aviso.tipo === "erro" ? "var(--red)" : "var(--green)" }}>
              <span>{aviso.texto}</span>
              {aviso.link ? <Link href={`/listas?id=${aviso.link}`} style={{ color: "var(--gold-bright)" }}>Ir para o squad →</Link> : null}
              <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

function Caixa({ marcado, parcial = false }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 5, flex: "0 0 18px",
      border: `1.5px solid ${marcado || parcial ? "var(--neon-a, var(--gold))" : "var(--line-strong)"}`,
      background: marcado ? "var(--neon-a, var(--gold))" : "transparent",
      color: "var(--bg)", fontSize: 12, fontWeight: 700, lineHeight: 1,
    }}>{marcado ? "✓" : parcial ? <span style={{ width: 8, height: 2, background: "var(--neon-a, var(--gold))" }} /> : null}</span>
  );
}

/** Caixa de uma linha, dentro do <summary>: não abre nem fecha o card. */
export function MarcarCreator({ id, nome }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const marcado = ctx.marcado(id);
  const clicar = (e) => { e.preventDefault(); e.stopPropagation(); ctx.alternar(id); };
  return (
    <button type="button" role="checkbox" aria-checked={marcado} aria-label={`Selecionar ${nome}`}
      onClick={clicar}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.stopPropagation(); }}
      style={{ display: "grid", placeItems: "center", width: 28, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }}>
      <Caixa marcado={marcado} />
    </button>
  );
}
