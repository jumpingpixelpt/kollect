export default function BrandFit({ fits, clientLabel = "L'Oréal" }) {
  if (!fits?.length) return null;
  const sorted = [...fits].sort((a, b) => b.fit_score - a.fit_score);
  return (
    <div className="panel" style={{ marginBottom: 22 }}>
      <h3>Brand Fit Score <span>· {clientLabel}</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> o quanto a voz do creator combina com a persona de cada marca, extraída dos vídeos do perfil oficial.
        <b> Por que acompanhar:</b> rising star sem fit é mídia cara — o fit diz <i>pra qual marca</i> esse talento serve.
      </div>
      {sorted.map((f, i) => (
        <div className="pillar" key={f.brands.name}>
          <div className="row">
            <span>{f.brands.name}</span>
            <b>{Number(f.fit_score).toFixed(0)} / 100</b>
          </div>
          <div className="track"><div className="fill" style={{ width: `${f.fit_score}%`, opacity: i === 0 ? 1 : 0.55 }} /></div>
          {f.rationale && <div className="fit-rationale">{f.rationale}</div>}
        </div>
      ))}
      <div className="formula-note">
        Persona de cada marca extraída por IA da <b>transcrição real dos vídeos do perfil oficial</b>; o fit cruza
        essa persona com legendas, transcrições e histórico comercial do creator.
        Melhor fit: <span style={{ color: "var(--gold-bright)" }}>{sorted[0].brands.name}</span>.
      </div>
    </div>
  );
}
