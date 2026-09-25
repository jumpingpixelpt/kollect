"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Criar uma squad list VAZIA a partir da própria página (pedido do utilizador, 02/09/2026).
 *
 * Até aqui uma lista só nascia com creators dentro — pela barra de seleção de /creators e
 * /descobertas ou pelo botão da ficha — e quem entrava na Squad List para começar uma não
 * tinha por onde. POST /api/lists sem itens cria a lista; a seguir vai-se direto para ela,
 * que é onde a pessoa queria estar.
 */
export default function ListCreate() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);

  async function criar(e) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) { setErro("dá um nome à squad list"); return; }
    setBusy(true); setErro(null);
    try {
      const r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, items: [] }) });
      const j = await r.json();
      if (j?.error || !j?.id) { setErro(mensagemErro(j, "não foi possível criar a squad list")); setBusy(false); return; }
      router.push(`/listas?id=${j.id}`);
      router.refresh();
    } catch { setErro("falha de rede"); setBusy(false); }
  }

  if (!aberto) {
    return <button className="gold-btn" style={{ padding: "12px 22px" }} onClick={() => setAberto(true)}>＋ Nova squad list</button>;
  }
  return (
    <form className="sel-panel" onSubmit={criar} style={{ flexWrap: "wrap", justifyContent: "center" }}>
      <input className="rl-search" autoFocus placeholder="Nome da squad list…" aria-label="Nome da squad list"
        value={nome} onChange={(e) => { setNome(e.target.value); setErro(null); }} disabled={busy} style={{ flex: "0 1 320px" }} />
      <button className="gold-btn" type="submit" disabled={busy}>{busy ? "A criar…" : "Criar"}</button>
      <button className="psearch-clear" type="button" disabled={busy} onClick={() => { setAberto(false); setNome(""); setErro(null); }}>Cancelar</button>
      {erro && <span style={{ alignSelf: "center", flexBasis: "100%", fontSize: 12, color: "var(--red)" }}>{erro}</span>}
    </form>
  );
}
