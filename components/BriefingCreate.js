"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Criação de briefing — brief-first: nasce só com nome + caracterização (o pedido
 * do cliente), sem membros. Os candidatos anexam-se depois, nas Descobertas.
 */
export default function BriefingCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [caracterizacao, setCaracterizacao] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function create() {
    if (!name.trim() || busy) { if (!name.trim()) setMsg("Dê um nome à análise."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/briefings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, caracterizacao }),
      });
      const j = await r.json();
      if (j.error) setMsg(mensagemErro(j));
      else if (j.id) { setOpen(false); setName(""); setCaracterizacao(""); router.push(`/briefings?id=${j.id}`); router.refresh(); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  if (!open) return <button className="gold-btn brief-open" onClick={() => setOpen(true)}>✎ Nova análise</button>;

  return (
    <div className="brief-panel">
      <h2>Nova <span>análise</span></h2>
      <p className="brief-lead">O pedido primeiro, os nomes depois — descreva o que o cliente procura; os candidatos anexam-se depois nas Descobertas.</p>
      <label className="brief-field">
        <span className="brief-label">Nome</span>
        <input className="brief-input" placeholder="ex.: Skincare 50–200k · lançamento X" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} autoFocus disabled={busy} />
      </label>
      <label className="brief-field">
        <span className="brief-label">Caracterização · o pedido do cliente</span>
        <textarea className="brief-input" rows={4} placeholder="Perfil procurado, nicho, faixa de seguidores, tom, contexto da campanha…"
          value={caracterizacao} onChange={(e) => setCaracterizacao(e.target.value)} disabled={busy} />
      </label>
      <div className="brief-acts">
        <button className="gold-btn" onClick={create} disabled={busy}>{busy ? "Criando…" : "Criar análise"}</button>
        <button className="chip" onClick={() => { setOpen(false); setMsg(null); }} disabled={busy}>Cancelar</button>
        {msg && <span className="sel-msg">{msg}</span>}
      </div>
    </div>
  );
}
