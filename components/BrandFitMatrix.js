import PainelPendente from "@/components/PainelPendente";
export default function BrandFitMatrix({ fits }) {
  const rows = [...(fits || [])].sort((a, b) => b.fit_score - a.fit_score);
  if (!rows.length) return <PainelPendente titulo="Brand Fit" sub="aderência por marca" passo="fit (/api/pipeline/brand-fit)" />;
  const cor = (f) => (f >= 70 ? "var(--green)" : f >= 50 ? "var(--gold-bright)" : f >= 35 ? "var(--text-dim)" : "var(--red)");
  const decision = (f) => (f >= 70 ? "Recommended" : f >= 50 ? "Watchlist" : f >= 35 ? "Low Fit" : "Not recommended");
  return (
    <div className="panel">
      <h3>Brand Fit Matrix <span>· creator × portfólio L'Oréal</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> o fit dela com cada marca do portfólio, não só com uma campanha.
        <b> Por que acompanhar:</b> diz qual marca da casa contrata primeiro — e qual não faz sentido.
      </div>
      <div className="bfm">
        {rows.map((f) => (
          <div className="bfm-row" key={f.brands?.name || Math.random()}>
            <span className="bfm-marca">{f.brands?.name}</span>
            <span className="bfm-dec" style={{ color: cor(f.fit_score), borderColor: cor(f.fit_score) }}>{decision(f.fit_score)}</span>
            <span className="bfm-fit">{Number(f.fit_score).toFixed(0)}</span>
            <span className="bfm-why">{(f.rationale || "").split(/[.;]/)[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
