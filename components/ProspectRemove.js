"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Remover uma descoberta do funil (pedido do operador: toda descoberta em erro tem de
 *  poder sair da fila). Mesmo padrão do CampaignRemove: × discreto, modal de confirmação
 *  via portal em document.body — fora de qualquer ancestral com transform. */
export default function ProspectRemove({ tubularId, nome }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [erro, setErro] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const confirmar = async () => {
    if (busy) return;
    setBusy(true); setErro(null);
    try {
      const r = await fetch("/api/prospect-delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tubular_id: tubularId }) });
      const j = await r.json();
      if (j?.error || j?.fatal) { setErro(j.error || j.fatal); setBusy(false); return; }
      setAsk(false);
      router.refresh();
    } catch { setErro("falha de rede"); }
    setBusy(false);
  };

  const modal = (
    <div
      onClick={() => !busy && setAsk(false)}
      style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ boxSizing: "border-box", background: "var(--card, #14110d)", border: "1px solid var(--line-strong, #3a3224)", borderRadius: 14, padding: "22px 24px", maxWidth: 380, width: "100%", boxShadow: "0 18px 50px var(--shadow-c)" }}
      >
        <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "var(--gold-bright, #e7c87a)", marginBottom: 8 }}>Remover esta descoberta?</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim, #c9c2b5)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <strong>{nome || "Este perfil"}</strong> sai da fila de descobertas. Nada pago se perde — e se uma varredura futura voltar a encontrar o perfil, ele volta a entrar.
        </div>
        {erro && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 10 }}>{erro}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button
            onClick={() => setAsk(false)}
            disabled={busy}
            style={{ flex: "0 0 auto", whiteSpace: "nowrap", background: "transparent", color: "var(--text-dim, #c9c2b5)", border: "1px solid var(--line, #2a2418)", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >Cancelar</button>
          <button
            onClick={confirmar}
            disabled={busy}
            style={{ flex: "0 0 auto", whiteSpace: "nowrap", background: "#e0524a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}
          >{busy ? "Removendo…" : "Sim, remover"}</button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setAsk(true)}
        disabled={busy}
        title="Remover da descoberta"
        aria-label="Remover da descoberta"
        style={{ flex: "0 0 auto", background: "transparent", border: "none", color: "#e0524a", borderRadius: 6, width: 18, height: 18, padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, lineHeight: 1, opacity: busy ? 0.4 : 0.85 }}
      >×</button>

      {ask && mounted && createPortal(modal, document.body)}
    </>
  );
}
