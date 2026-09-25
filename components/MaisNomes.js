"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * «Mais nomes» (feedback rodada 2, F1.3 — proposta da D3).
 *
 * Contrato com a página do briefing: `<MaisNomes campaignId visiveis />`, montado quando a
 * lista tem menos de 20 nomes ou está vazia (`visiveis` = nomes à vista; 0 = estado vazio).
 *
 * Um clique alarga a busca (POST /api/campaign {mais: id} — runMais no route): mais temas,
 * limiar semântico mais baixo, faixa de seguidores ±1 faixa, e prospects da base de
 * descoberta que casam por nome/@/termo ("a analisar"). Os nomes novos entram com o lote
 * seguinte (campaign_creators.lote) — no FIM da lista, sem reordenar o que já estava à
 * vista — e a página é refrescada (router.refresh). Pode demorar alguns segundos.
 */
export default function MaisNomes({ campaignId, visiveis = 0 }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const pedir = async () => {
    if (busy || !campaignId) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch("/api/campaign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mais: campaignId }),
      });
      const j = await r.json();
      if (j.error || j.fatal) { setErr(mensagemErro(j, "Não foi possível alargar a busca. Tente de novo em alguns minutos.")); return; }
      const n = Number(j.novos) || 0;
      setMsg(n
        ? `${n} ${n === 1 ? "nome novo adicionado" : "nomes novos adicionados"} no fim da lista.`
        : "Não encontramos mais nomes para este briefing com a busca alargada.");
      if (n) router.refresh();
    } catch {
      setErr("Sem ligação ao servidor. Verifique a internet e tente de novo.");
    } finally { setBusy(false); }
  };

  const vazio = !visiveis;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", fontFamily: "inherit" }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: 520, lineHeight: 1.5, fontFamily: "var(--sans, inherit)" }}>
        {vazio
          ? "A busca ainda não encontrou nomes. Podemos alargá-la com temas relacionados, uma faixa de seguidores mais larga e perfis da base de descoberta."
          : `Só ${visiveis} ${visiveis === 1 ? "nome" : "nomes"} até agora. Alargue a busca — os novos entram no fim da lista, sem mudar a ordem atual.`}
      </div>
      <button className="psearch-btn" type="button" onClick={pedir} disabled={busy} aria-busy={busy}>
        Mais nomes
      </button>
      {busy && <div style={{ fontSize: 12.5, color: "var(--text-faint)", fontFamily: "var(--sans, inherit)" }} role="status">Alargando a busca… pode levar alguns segundos.</div>}
      {msg && !err && <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontFamily: "var(--sans, inherit)" }} role="status">{msg}</div>}
      {err && <div className="briefing-err" role="alert">{err}</div>}
    </div>
  );
}
