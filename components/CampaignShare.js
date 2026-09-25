"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Partilhar um briefing com colegas (pedido de 03/09/2026). Vive ao lado do "Apagar
 * briefing" no detalhe: o dono (ou um admin) escolhe quem passa a ver o briefing.
 *
 * A lista traz só operadores: os admins veem todos os briefings de raiz, partilhar com
 * eles não mudava nada (03/09/2026). O painel só pede a lista quando abre — o detalhe do
 * briefing já faz consultas suficientes. Guardar envia o conjunto inteiro (POST /api/campaign-share) e
 * recarrega a página: a etiqueta "partilhado com N" e a lista do colega actualizam-se
 * pelo servidor, não por estado duplicado aqui.
 */
export default function CampaignShare({ campaignId, shared = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dados, setDados] = useState(null);
  const [sel, setSel] = useState(() => new Set(shared));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open || dados) return;
    let vivo = true;
    fetch(`/api/campaign-share?campaign_id=${encodeURIComponent(campaignId)}`)
      .then((r) => r.json())
      .then((j) => { if (!vivo) return; if (j.error || j.fatal) setMsg(mensagemErro(j)); else { setDados(j); setSel(new Set(j.shared_with ?? [])); } })
      .catch(() => vivo && setMsg("Falha de rede."));
    return () => { vivo = false; };
  }, [open, dados, campaignId]);

  // clique fora fecha, como um menu
  useEffect(() => {
    if (!open) return;
    const fora = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [open]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todos = dados?.utilizadores ?? [];
  const todosSel = todos.length > 0 && todos.every((u) => sel.has(u.id));

  async function guardar() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/campaign-share", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, user_ids: [...sel] }),
      });
      const j = await r.json();
      if (j.error || j.fatal) { setMsg(mensagemErro(j)); setBusy(false); return; }
      setOpen(false); setDados(null); setBusy(false);
      router.refresh();
    } catch { setMsg("Falha de rede."); setBusy(false); }
  }

  const n = shared.length;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button className={`chip${n ? " active" : ""}`} onClick={() => setOpen((o) => !o)} title="Partilhar este briefing com colegas">
        {n ? `Partilhado com ${n}` : "Partilhar"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 30, minWidth: 300, background: "var(--card)", border: "1px solid var(--line-strong)", padding: "16px 18px", boxShadow: "0 12px 34px var(--shadow-c)" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 16, marginBottom: 4 }}>Partilhar <span style={{ color: "var(--gold)" }}>briefing</span></div>
          <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, margin: "0 0 12px" }}>
            Quem for escolhido passa a ver este briefing e o casting nas suas listas. Só o dono o pode apagar. Os admins já veem todos os briefings, por isso não aparecem aqui.
          </p>
          {!dados && !msg && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>A carregar utilizadores…</div>}
          {dados && !todos.length && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Não há operadores com quem partilhar — os admins já veem tudo.</div>}
          {todos.length > 0 && (
            <div style={{ display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--text-dim)", paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>
                <input type="checkbox" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(todos.map((u) => u.id)))} disabled={busy} />
                Todos os operadores
              </label>
              {todos.map((u) => (
                <label key={u.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} disabled={busy} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}{u.id === dados.eu ? " (você)" : ""}</span>
                </label>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
            <button className="gold-btn" style={{ padding: "9px 18px" }} onClick={guardar} disabled={busy || !dados}>{busy ? "Guardando…" : "Guardar"}</button>
            <button className="chip" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
          </div>
          {msg && <div className="sel-msg" style={{ marginTop: 10, fontSize: 12 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
