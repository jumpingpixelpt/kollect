import PainelPendente from "@/components/PainelPendente";
import { r2 } from "@/lib/numeros";
export default function TerritoryMap({ nichos }) {
  const rows = [...(nichos || [])]
    .map((n) => ({ nome: String(n.nicho), pct: Number(n.pct) || 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 7);
  if (!rows.length) return <PainelPendente titulo="Território" sub="onde ela joga" passo="marcas (/api/brand-scan)" />;
  const core = rows[0];
  return (
    <div className="panel">
      <h3>Territory Map <span>· onde ela é forte</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> a força da creator por território de conteúdo. <b>Core:</b> {core.nome} ({r2(core.pct)}%).
        <b> Por que acompanhar:</b> L'Oréal trabalha por categoria e marca — isso diz pra qual território ela serve.
      </div>
      <div className="tmap">
        {rows.map((r) => (
          <div className="tmap-row" key={r.nome}>
            <span className="tmap-lbl">{r.nome}</span>
            <span className="tmap-bar"><span className="tmap-fill" style={{ width: `${Math.max(4, r.pct)}%`, opacity: r.pct >= 50 ? 1 : r.pct >= 20 ? 0.7 : 0.4 }} /></span>
            <span className="tmap-pct">{r2(r.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
