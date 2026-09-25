import PainelPendente from "@/components/PainelPendente";
import { r2 } from "@/lib/numeros";
const TIPO = {
  publi: ["Publi declarada", "var(--gold-bright)"],
  afiliado: ["Afiliado", "var(--green)"],
  seeding: ["Recebidos / seeding", "var(--text-dim)"],
  organica: ["Menção orgânica", "var(--text-faint)"],
};
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : Math.round(n);

export default function BrandHistory({ history }) {
  if (!history) return <PainelPendente titulo="Histórico de Marcas" sub="quem já chegou primeiro" passo="marcas (/api/brand-scan)" />;
  if (!history.marcas?.length) {
    return (
      <div className="panel">
        <h3>Histórico de Marcas <span>· quem já chegou primeiro</span></h3>
        <div className="forecast-cell">
          <div className="v" style={{ fontSize: 17, color: "var(--green)" }}>Comercialmente virgem</div>
          <div className="k" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            Nenhuma parceria, publi ou afiliação detectada em {history.videos_analisados ?? "—"} vídeos do último ano —
            nenhuma marca chegou primeiro. Cachê tende a ser barato e a marca que entrar agora define o padrão.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="panel panel-fit">
      <h3>Histórico de Marcas <span>· quem já chegou primeiro</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> as marcas que já trabalharam com o creator, extraídas das legendas do último ano
        ({history.videos_analisados} vídeos analisados por IA). <b>Por que acompanhar:</b> mostra concorrência
        no talento, calibra cachê e revela se o creator já tem maturidade comercial.
      </div>
      {history.brand_engagement && (
        <div className="forecast-cell" style={{ marginBottom: 18, flex: "0 0 auto" }}>
          <div className="v" style={{ fontSize: 17, color: history.brand_engagement.ratio >= 1.1 ? "var(--green)" : history.brand_engagement.ratio >= 0.85 ? "var(--gold-bright)" : "var(--red)" }}>
            Brand Engagement: {history.brand_engagement.ratio >= 1 ? "+" : "−"}{Math.abs(Math.round((history.brand_engagement.ratio - 1) * 100))}% vs orgânico
          </div>
          <div className="k" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            {history.brand_engagement.leitura} ({history.brand_engagement.videos_comerciais} vídeos comerciais vs {history.brand_engagement.videos_organicos} orgânicos
            {history.brand_engagement.eng_comercial_pct != null
              ? ` · eng. mediano ${r2(history.brand_engagement.eng_comercial_pct)}% vs ${r2(history.brand_engagement.eng_organico_pct)}%`
              : ` · medido por ${history.brand_engagement.metrica || "alcance"}`})
          </div>
        </div>
      )}
      <div className="bh-scroll">
        {history.marcas.slice(0, 10).map((m) => (
          <div className="video" key={m.marca}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <span className="t">{m.marca}</span>
              <span style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: TIPO[m.tipo]?.[1] || "var(--text-dim)", whiteSpace: "nowrap" }}>
                {TIPO[m.tipo]?.[0] || m.tipo}
              </span>
            </div>
            <div className="stats-line">
              {m.videos} vídeo{m.videos > 1 ? "s" : ""}{m.views_total ? ` · ${fmt(m.views_total)} views` : ""}{m.ultima ? ` · último em ${m.ultima}` : ""}
            </div>
            {m.evidencia && <div className="transcript">"{m.evidencia}"</div>}
          </div>
        ))}
        {history.resumo && <div className="formula-note">{history.resumo}</div>}
      </div>
    </div>
  );
}
