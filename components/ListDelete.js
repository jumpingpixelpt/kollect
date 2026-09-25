"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { mensagemErro } from "@/lib/erro-cliente";

/** Apagar uma lista inteira (pedido do operador, jul/2026). Leva só a lista e as
 *  associações — nenhum creator ou prospect é tocado. Padrão do CampaignDelete:
 *  botão discreto, modal de confirmação via portal, redirect no fim. */
export default function ListDelete({ listId, name }) {
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
      const r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete_list", list_id: listId }) });
      const j = await r.json();
      if (j?.error || j?.fatal) { setErro(mensagemErro(j)); setBusy(false); return; }
      router.push("/listas");
      router.refresh();
    } catch { setErro("falha de rede"); setBusy(false); }
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
        <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "var(--gold-bright, #e7c87a)", marginBottom: 8 }}>Apagar esta squad list?</div>
        <div style={{ fontSize: 13.5, color: "var(--text-dim, #c9c2b5)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
          <strong>{name || "A squad list"}</strong> desaparece com todas as suas associações. Os creators e prospects não são tocados — continuam no radar e na descoberta.
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
          >{busy ? "Apagando…" : "Sim, apagar"}</button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setAsk(true)}
        disabled={busy}
        className="chip"
        style={{ color: "#e0524a", borderColor: "rgba(224,82,74,.35)", cursor: "pointer" }}
      >Apagar squad list</button>

      {ask && mounted && createPortal(modal, document.body)}
    </>
  );
}
