"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motivoDaFalha } from "@/lib/promote-error";
import ErroComLink from "./ErroComLink";

export default function PromoteButton({ tubularId, status }) {
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");
  const router = useRouter();

  if (status === "promovido") return <span className="tag gold">no radar ✓</span>;
  // Estados escritos pela importação em lote (lib/promover-lote.js). Quem já está no radar
  // por handle não pode ter botão: re-promover faz upsert no creator e apaga-lhe os vídeos
  // e as análises. Os outros mantêm o botão, com o motivo à vista.
  if (status?.startsWith("ja_no_radar:")) return <span className="tag gold" title="handle já existe em creators">no radar (por handle) ✓</span>;
  if (status?.startsWith("promovendo:")) return <span className="tag">promovendo pelo lote…</span>;
  const notaLote = status?.startsWith("falha_promocao:") ? `lote: ${status.slice("falha_promocao:".length)}`
    : status?.startsWith("duplicado_handle:") ? "lote: mesmo handle de outro prospect já promovido"
    : status === "sem_handle:lixo" ? "lote: handle inválido" : null;

  async function promote() {
    setSt("running"); setMsg("");
    try {
      const r = await fetch(`/api/promote?tubular_id=${encodeURIComponent(tubularId)}`);
      const j = await r.json();
      // formato novo (promote-ic/apify: objeto direto) ou antigo (tubular: detalhes[])
      const viaIc = j?.ok && j?.creator_id ? j : null;
      const viaTubular = j?.detalhes?.find((d) => d.ok);
      const ok = viaIc || viaTubular;
      if (ok?.creator_id) {
        setSt("done");
        // caminho tubular ainda precisa do enrich disparado pelo cliente; o IC já dispara sozinho
        if (viaTubular) fetch(`/api/enrich?handle=${encodeURIComponent(ok.handle)}`, { keepalive: true }).catch(() => {});
        // NÃO navega pro perfil: o usuário permanece na Descoberta; só atualiza o card in-place.
        router.refresh();
      } else {
        setSt("error");
        setMsg(motivoDaFalha(j));
      }
    } catch { setSt("error"); setMsg("erro de rede / tempo esgotado"); }
  }

  if (st === "done") return <span className="tag gold">no radar ✓</span>;

  return (
    <div style={{ textAlign: "right" }}>
      <button className="gold-btn crm-btn" onClick={promote} disabled={st === "running"} style={{ whiteSpace: "nowrap" }}>
        {st === "running" ? "Promovendo… (~1 min)" : st === "error" ? "Tentar de novo" : "Promover ao radar ↗"}
      </button>
      {msg && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 5, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.35, overflowWrap: "anywhere" }}><ErroComLink texto={msg} /></div>}
      {!msg && notaLote && <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 5, maxWidth: 260, whiteSpace: "normal", lineHeight: 1.35, overflowWrap: "anywhere" }}><ErroComLink texto={notaLote} /></div>}
    </div>
  );
}
