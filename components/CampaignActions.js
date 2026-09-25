"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";
import { csvPtBr } from "@/lib/squad-csv";

/**
 * Ações do casting. "Approve recommended squad" saiu com os estados aprovada/descartada
 * (feedback do cliente, set/2026, ponto 11): a decisão passa a ser adicionar nomes a uma
 * squad. A defesa de casting fica, mas sem score e sem papéis — só a tag e a evidência.
 *
 * Paginação 20 a 20 (22/09/2026): os dados do CSV e da defesa deixaram de vir embutidos na
 * página — pedem-se no clique a /api/campanha-export (todas as linhas da tag `tipo`, como
 * antes). Sem cache: o casting muda com remoções, estados e «Atualizar casting».
 */
export default function CampaignActions({ campaignId, campaignName, rationale, tipo = null }) {
  const router = useRouter();
  const [recasting, setRecasting] = useState(false);
  const [defense, setDefense] = useState(null);
  const [copied, setCopied] = useState(false);
  const [aviso, setAviso] = useState(null); // erros das ações, inline (era alert)
  const [aPreparar, setAPreparar] = useState(null); // "csv" | "defesa" enquanto os dados chegam

  async function carregarDados(qual) {
    setAPreparar(qual); setAviso(null);
    try {
      const j = await fetch(`/api/campanha-export?id=${encodeURIComponent(campaignId)}${tipo ? `&tipo=${encodeURIComponent(tipo)}` : ""}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!j || j.error || j.fatal || !Array.isArray(j.data)) {
        setAviso(mensagemErro(j, "Não foi possível preparar os dados do casting. Tente de novo."));
        return null;
      }
      return j.data;
    } finally { setAPreparar(null); }
  }

  async function recast() {
    if (recasting) return;
    // as decisões (em estudo) e as adições manuais são preservadas pela API; o que se
    // perde são as sugestões automáticas por decidir
    if (!confirm(`Atualizar o casting de ${campaignName}?\n\nAs creators que já pôs em estudo ou adicionou à mão MANTÊM-SE (os números delas são refrescados).\n\nAs sugestões automáticas ainda por decidir são recalculadas do zero com o radar de hoje.`)) return;
    setRecasting(true); setAviso(null);
    try {
      const r = await fetch(`/api/campaign?rerun=${campaignId}&cb=${Date.now()}`, { signal: AbortSignal.timeout(120000) }).then((x) => x.json()).catch(() => null);
      // só a frase amigável (feedback rodada 2, bug 1): nunca o texto do provedor
      if (!r) setAviso("Não foi possível atualizar o casting agora. Verifique a ligação e tente de novo.");
      else if (r.error || r.fatal) setAviso(`Não foi possível atualizar o casting. ${mensagemErro(r)}`);
      router.refresh();
    } finally { setRecasting(false); }
  }

  async function exportCsv() {
    if (aPreparar) return;
    const data = await carregarDados("csv");
    if (!data) return;
    // sem o composto "/100" (F1.9, proposta da D2): requisitos como "N de M"; a ordem é a
    // da página, aderência ao briefing
    const head = ["Creator", "Handle", "Requisitos atingidos", "Tag", "Território", "Seguidores", "Engagement rate", "Engajamento", "Consistência", "Comentários", "Público", "Por que entra"];
    // `;` + BOM UTF-8 (F2.4): com `,` o Excel em pt-BR abria tudo numa coluna só
    const lines = [head];
    data.forEach((d) => lines.push([d.name, d.handle, d.requisitos, d.tag, d.territory, d.followers, d.er, d.eng, d.consist, d.comentarios, d.publico, d.why]));
    const blob = new Blob([csvPtBr(lines)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `casting-${(campaignName || "campanha").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function genDefense() {
    if (aPreparar) return;
    const data = await carregarDados("defesa");
    if (!data) return;
    const top = data.slice(0, 8).map((d) => `• ${d.name} (${d.tag} · ${d.followers} seguidores) — ${d.why}`).join("\n");
    const txt =
`DEFESA DE CASTING — ${campaignName}

${rationale}

DESTAQUES DA LISTA
${top}

A lista organiza a evidência — território, engajamento, consistência e público — para a equipa decidir; não substitui a avaliação de quem conhece a marca.`;
    setDefense(txt);
    setCopied(false);
  }

  async function copyDefense() {
    try { await navigator.clipboard.writeText(defense); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  const btn = { fontSize: 12.5, padding: "9px 16px", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--card)", color: "var(--text)", cursor: "pointer", letterSpacing: ".02em", whiteSpace: "nowrap" };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btn} onClick={genDefense} disabled={!!aPreparar}>{aPreparar === "defesa" ? "A preparar…" : "✦ Gerar defesa do casting"}</button>
        <button style={btn} onClick={exportCsv} disabled={!!aPreparar}>{aPreparar === "csv" ? "A preparar…" : "↧ Exportar casting (CSV)"}</button>
        <button style={btn} onClick={recast} disabled={recasting} title="Reprocessa o casting com os creators mais recentes do radar">{recasting ? "Atualizando casting… ~1 min" : "↻ Atualizar casting"}</button>
      </div>
      {aviso && (
        <div role="alert" style={{ marginTop: 10, fontSize: 12.5, color: "var(--red)", display: "flex", gap: 10, alignItems: "baseline" }}>
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 12 }} aria-label="Fechar aviso">✕</button>
        </div>
      )}
      {defense != null && (
        <div style={{ marginTop: 12, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold)" }}>Defesa do casting</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn, padding: "5px 12px", fontSize: 11.5 }} onClick={copyDefense}>{copied ? "Copiado ✓" : "Copiar"}</button>
              <button style={{ ...btn, padding: "5px 12px", fontSize: 11.5 }} onClick={() => setDefense(null)}>Fechar</button>
            </span>
          </div>
          <textarea readOnly value={defense} style={{ width: "100%", minHeight: 200, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 12.5, lineHeight: 1.5, fontFamily: "var(--sans, system-ui, sans-serif)", resize: "vertical", whiteSpace: "pre-wrap" }} />
        </div>
      )}
    </div>
  );
}
