import PainelPendente from "@/components/PainelPendente";
const COR = {
  "especialista": "var(--green)", "afinidade forte": "var(--gold-bright)", "difuso": "var(--red)",
  "muito forte": "var(--green)", "acima da média": "var(--gold-bright)", "na média": "var(--text-dim)", "fraco": "var(--red)",
  "viraliza": "var(--green)", "forte": "var(--gold-bright)", "normal": "var(--text-dim)", "baixa": "var(--green)",
  "muito consistente": "var(--green)", "consistente": "var(--gold-bright)", "irregular": "var(--red)", "inconsistente": "var(--red)",
  "topo (P75+)": "var(--gold-bright)", "meio (P30–P75)": "var(--text-dim)", "base (<P30)": "var(--teal)",
  "limpo": "var(--green)", "moderada": "var(--gold-bright)", "red flag": "var(--red)", "sem dado": "var(--text-faint)",
};
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}º`);
// Reach Efficiency extrema (conteúdo viral, views >> base) vira "10×+" pra não parecer bug.
const reachShow = (r) => (r == null ? null : r >= 10 ? "10×+" : `${r}×`);

export default function KolScreen({ screen, audience }) {
  const criterios = screen?.defesa || screen?.criterios;
  if (!criterios) return <PainelPendente titulo="Screening KOL" sub="critérios de classe" passo="kol (/api/kol-screen)" />;
  const m = screen.metricas || {};
  const a = audience || {};
  const cred = a.credibilidade_pct ?? null;
  const notaveis = a.notaveis_pct ?? null;


  return (
    <div className="panel">
      <h3>Methodology Layer <span>— How the system decided</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> a prova técnica por trás da classe — os cinco sinais <b>relativos aos pares do mesmo nicho e faixa</b> (não números absolutos) que o motor cruza pra cravar KOL/Rising/etc.
        <b> Por que existe:</b> é a camada de auditoria pra Intel / Global / Procurement — a decisão pro cliente está no topo (Executive Recommendation).
      </div>
      {/* O veredicto de classe saiu daqui: era a classe do SCREENING (5 classes), em
          contradição com o badge do §8 que a ficha mostra no topo — e a própria descrição
          deste painel diz que "a decisão pro cliente está no topo". Ficam as métricas e os
          critérios, que são a auditoria; o rótulo vive num sítio só. */}
      <div className="formula-note" style={{ marginTop: 6, marginBottom: 14, borderTop: "none", paddingTop: 0 }}>
        {m.niche_bucket ? <>Nicho <b style={{ color: "var(--gold-bright)" }}>{m.niche_bucket}</b> · faixa {m.band || "—"} · </> : null}
        Engagement Index <b style={{ color: "var(--gold)" }}>{m.eng_index != null ? `${m.eng_index}×` : "—"}</b> · Reach Eff. <b style={{ color: "var(--gold)" }}>{reachShow(m.reach_eff) || "—"}</b> · Consistency <b style={{ color: "var(--gold)" }}>{m.consistency_pct != null ? `${m.consistency_pct}%` : "—"}</b> · Percentil <b style={{ color: "var(--gold)" }}>{pct(m.follower_pct)}</b>
      </div>
      {screen.classe === "rising_star" && screen.rising_provisorio && (
        <div className="formula-note" style={{ marginTop: -8, marginBottom: 14, borderTop: "none", paddingTop: 0, color: "var(--text-dim)" }}>{screen.rising_provisorio}</div>
      )}
      <details>
        <summary className="methodology-toggle">▸ Ver os 5 critérios e o cálculo</summary>
        {criterios.map((cr) => (
          <div className="pillar" key={cr.id}>
            <div className="row">
              <span>{cr.nome} <span style={{ color: "var(--text-faint)" }}>— {cr.detalhe}</span></span>
              <b style={{ color: COR[cr.resultado] || "var(--text-dim)", whiteSpace: "nowrap", textTransform: "uppercase", fontSize: 11, letterSpacing: "0.08em" }}>{cr.resultado}</b>
            </div>
          </div>
        ))}
        <div className="formula-note">{screen.eng_index_nota || "Engagement Index = (likes+comments)/views vs mediana do nicho×faixa; shares/saves têm baixa cobertura."}</div>
        <div className="formula-note" style={{ color: "var(--text-faint)" }}><b>Limitações do dado:</b> comparação contra o peer group do nicho×faixa (amostra varia por célula); shares/saves têm baixa cobertura; Growth Index ainda imaturo (Rising provisório). Sinais se reforçam conforme a série temporal amadurece.</div>
      </details>
    </div>
  );
}
