"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CampaignDelete({ campaignId, name, label, redirectTo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function del(e) {
    e.preventDefault(); e.stopPropagation();
    if (busy) return;
    if (!confirm(`Apagar a campanha "${name || "Campanha"}"? O briefing e o casting gerado serão removidos. Essa ação não tem volta.`)) return;
    setBusy(true);
    try {
      await fetch("/api/campaign-delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch { setBusy(false); }
  }

  if (label) {
    return (
      <button
        onClick={del}
        disabled={busy}
        title="Apagar briefing/campanha"
        className="chip"
        style={{ borderColor: "rgba(220,90,90,.5)", color: "#e89090" }}
      >
        {busy ? "Apagando…" : label}
      </button>
    );
  }

  return (
    <button onClick={del} disabled={busy} title="Apagar campanha" aria-label="Apagar campanha" className="camp-del">
      {busy ? "…" : "×"}
    </button>
  );
}
