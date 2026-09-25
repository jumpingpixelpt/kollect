"use client";
import { CLIENTS, clientLabel } from "@/lib/clients";

export default function ClientSwitcher({ current }) {
  const change = (v) => {
    const url = new URL(window.location.href);
    url.searchParams.set("cliente", v);
    window.location.href = url.toString();
  };
  // Um cliente só: vira selo estático (sem dropdown sem sentido).
  if (CLIENTS.length < 2) {
    return <span className="client-tag">{clientLabel(current)}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--gold-bright, #e3c06b)", borderRadius: 4, padding: "5px 12px", background: "rgba(227,192,107,0.06)" }}>
      <span style={{ fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim, #9a9a9a)" }}>Cliente</span>
      <select value={current} onChange={(e) => change(e.target.value)} title="Trocar cliente"
        style={{ background: "transparent", border: "none", color: "var(--gold-bright, #e3c06b)", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", outline: "none" }}>
        {CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.label} ▾</option>)}
      </select>
    </span>
  );
}
