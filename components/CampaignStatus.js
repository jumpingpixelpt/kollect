"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Aprovada e Descartada saíram do casting (feedback do cliente, set/2026, ponto 11): a
// decisão passa a ser "adicionar a uma squad", não um carimbo na linha. Linhas antigas que
// ainda têm esses estados continuam a mostrá-los, só não se voltam a escolher.
export const STATUS_LABEL = { sugerida: "Sugerida", em_estudo: "Em estudo" };
const LEGADO = { aprovada: "Aprovada", descartada: "Descartada" };

export default function CampaignStatus({ rowId, status }) {
  const router = useRouter();
  const [v, setV] = useState(status || "sugerida");
  const [busy, setBusy] = useState(false);

  const change = async (s) => {
    setV(s); setBusy(true);
    await fetch("/api/campaign-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ row_id: rowId, status: s }) });
    setBusy(false);
    router.refresh();
  };

  return (
    <span className="filter-select-wrap">
      <select className={`filter-select camp-status camp-${v}`} value={v} disabled={busy} onChange={(e) => change(e.target.value)}>
        {Object.entries(STATUS_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        {LEGADO[v] && <option value={v}>{LEGADO[v]}</option>}
      </select>
      <span className="filter-caret">▾</span>
    </span>
  );
}
