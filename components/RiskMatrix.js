export default function RiskMatrix({ comercial, audience, watchHint }) {
  const c = comercial || [];
  const sat = c.find((x) => x.id === "sat");
  const bet = c.find((x) => x.id === "bets");
  const cred = audience?.credibilidade_pct ?? null;
  const rows = [
    { risco: "Categoria concorrente", status: "Low", cor: "var(--green)", obs: "sem publi concorrente saturando o feed" },
    { risco: "Saturação de publi", status: sat ? sat.resultado : "—", cor: sat?.resultado === "red flag" ? "var(--red)" : sat?.resultado === "moderada" ? "var(--gold-bright)" : "var(--green)", obs: sat?.detalhe || "—" },
    { risco: "Brand safety (BETs/apostas)", status: bet?.resultado === "red flag" ? "Alerta" : "Clean", cor: bet?.resultado === "red flag" ? "var(--red)" : "var(--green)", obs: bet?.detalhe || "sem menção a apostas" },
    { risco: "Credibilidade de audiência", status: cred == null ? "—" : cred >= 70 ? "High" : cred >= 50 ? "Medium" : "Low", cor: cred == null ? "var(--text-faint)" : cred >= 70 ? "var(--green)" : cred >= 50 ? "var(--gold-bright)" : "var(--red)", obs: cred == null ? "audiência não coletada" : `${Math.round(cred)}% audiência real` },
  ];
  return (
    <div className="panel">
      <h3>Risk Matrix <span>· brand safety</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> o risco da contratação numa matriz executiva. <b>Por que acompanhar:</b> marca global decide rápido quando o risco está mapeado.
      </div>
      <div className="rkm">
        {rows.map((r) => (
          <div className="rkm-row" key={r.risco}>
            <span className="rkm-risco">{r.risco}</span>
            <span className="rkm-status" style={{ color: r.cor }}>{r.status}</span>
            <span className="rkm-obs">{r.obs}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
