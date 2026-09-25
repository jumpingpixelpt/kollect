"use client";
import { useEffect, useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Adicionar o creator a uma squad list (lists/list_creators) — a única ação de casting que a
 * ficha enxuta mantém no cabeçalho, e desde set/2026 também a ação de cada linha do casting
 * (feedback do cliente, ponto 11: "add a um squad ou criar um squad novo" no lugar de
 * aprovar/descartar). Usa /api/lists (add_items para lista existente, POST normal para
 * criar). O add_items já ignora duplicados do lado do servidor.
 *
 * `compacto` encolhe o botão para caber numa linha de tabela; `sugerida` é a lista que o
 * briefing criou para si (lists.campaign_id) e vem pré-selecionada.
 */
export default function AddToList({ creatorId, nome, compacto = false, sugerida = null }) {
  const [aberto, setAberto] = useState(false);
  const [listas, setListas] = useState(null);
  const [alvo, setAlvo] = useState(sugerida?.id || "");
  const [nova, setNova] = useState("");
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    if (!aberto || listas) return;
    fetch("/api/lists").then((r) => r.json()).then((d) => setListas(d.lists ?? [])).catch(() => setListas([]));
  }, [aberto, listas]);

  async function guardar() {
    setEstado("a guardar…");
    try {
      const body = alvo
        ? { action: "add_items", list_id: alvo, items: [{ creator_id: creatorId }] }
        : { name: nova.trim(), items: [{ creator_id: creatorId }] };
      if (!alvo && !nova.trim()) return setEstado("dá um nome à squad");
      const r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) return setEstado(mensagemErro(d));
      setEstado(alvo && d.added === 0 ? `${nome} já estava nessa squad` : "adicionado ✓");
      setListas(null);
    } catch { setEstado("falha de rede — tente de novo"); }
  }

  if (!aberto) return <button className="chip" onClick={() => setAberto(true)} title={`Adicionar ${nome} a uma squad`}>{compacto ? "＋ Squad" : "＋ Adicionar a uma squad list"}</button>;

  const lista = listas ?? (sugerida ? [{ id: sugerida.id, name: sugerida.name, total: sugerida.total }] : []);

  return (
    <div className={`fc-addlist${compacto ? " fc-addlist-c" : ""}`}>
      <select value={alvo} onChange={(e) => { setAlvo(e.target.value); setEstado(null); }}>
        <option value="">— criar squad nova —</option>
        {lista.map((l) => <option key={l.id} value={l.id}>{l.name}{l.total != null ? ` (${l.total})` : ""}{sugerida?.id === l.id ? " · este briefing" : ""}</option>)}
      </select>
      {!alvo && <input placeholder="nome da squad" value={nova} onChange={(e) => setNova(e.target.value)} />}
      <button className="chip" onClick={guardar}>Guardar</button>
      <button className="chip" onClick={() => { setAberto(false); setEstado(null); }}>✕</button>
      {estado && <span className="fc-addlist-s">{estado}</span>}
    </div>
  );
}
