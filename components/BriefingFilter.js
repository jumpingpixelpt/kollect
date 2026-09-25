"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import FilterMultiSelect from "@/components/FilterMultiSelect";
import { rotuloTermo, fmtN } from "@/lib/termos";

/**
 * Filtro de termos dentro do detalhe do briefing — o mesmo dropdown de seleção
 * múltipla das Descobertas, mas sobre os candidatos DESTE briefing. Aplica no
 * botão (padrão do ProspectSearch); a seleção vai no URL (?termo= repetido) e
 * sobrevive à troca de aba e à paginação.
 */
export default function BriefingFilter({ briefingId, tab, termosSel = [], termos = [] }) {
  const router = useRouter();
  const [v, setV] = useState(termosSel);

  const url = (sel) => {
    const u = new URLSearchParams({ id: briefingId });
    if (tab === "radar") u.set("tab", "radar");
    for (const t of sel) u.append("termo", t);
    return `/briefings?${u.toString()}`;
  };

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: "16px 0 6px" }}>
      <FilterMultiSelect label="Termo de busca" values={v} minWidth={220}
        allLabel={`Todos os termos (${fmtN(termos.reduce((s, t) => s + t.n, 0))})`}
        options={termos.map((t) => [t.termo, `${rotuloTermo(t.termo)} (${fmtN(t.n)})`])}
        onChange={setV} />
      <button className="psearch-btn" onClick={() => router.push(url(v))}>Filtrar</button>
      {termosSel.length > 0 && (
        <button className="psearch-clear" onClick={() => { setV([]); router.push(url([])); }}>Limpar</button>
      )}
    </div>
  );
}
