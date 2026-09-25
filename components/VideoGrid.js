import AnalysisButton from "@/components/VideoReport";
import ChatButton from "@/components/VideoChat";

const fmt = (n) => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const HAIR = /cabelo|crespo|cachead|cacho|tran[çc]a|hidrata|finaliza|transi[çc]|capilar|\bfios?\b|loir|colora|mechas|pentead|liso|curly|afro|twist|braid|nutri|reconstru|frizz/i;
const MAKE = /maquiagem|make|batom|sombra|delineado|base |skincare|pele|s[ée]rum/i;

// leitura por vídeo: tema, formato, fit e por que importa (usa análise IA se houver, senão deriva do título)
function insight(v) {
  const t = (v.title || "").toLowerCase();
  const a = v.analysis || {};
  const tema = a.temas?.[0] || (HAIR.test(t) ? "haircare" : MAKE.test(t) ? "make/skincare" : "lifestyle");
  const isHair = HAIR.test(t) || /cabelo|capilar|hair/i.test(tema);
  const formato = a.formato || (/antes|depois|transforma/i.test(t) ? "antes & depois" : /tutorial|passo|como/i.test(t) ? "tutorial" : /rotina|cronograma/i.test(t) ? "rotina" : /penteado|twist|braid/i.test(t) ? "penteado" : "estético/mood");
  const fit = isHair ? "alto fit haircare" : "baixo fit campanha";
  const nota = isHair ? "Formato replicável pra produto de cabelo." : "Bom pra entender persona, não ideal pra produto.";
  return { tema, formato, fit, isHair, nota };
}

// O /api/thumb resolve a imagem a partir do próprio link do vídeo (o parâmetro `fb`):
// Instagram pelo /p|reel/, TikTok pelo oEmbed do id. O filtro abaixo só aceitava `thumb`
// já gravada ou Instagram, portanto escondia peças que sabíamos renderizar — a importação
// por link grava os vídeos sem thumb (a da Tubular é um proxy que exige login) e só o
// tubular-sync as preenche mais tarde. Entre um passo e o outro a dobra "Proof" dizia
// "8 vídeos registados, nenhum utilizável" com os 8 perfeitamente renderizáveis.
const isIg = (u) => /instagram\.com\/(p|reel|reels)\//.test(u || "");
const isTk = (u) => /tiktok\.com\/.*video\/\d+/.test(u || "");
const renderizavel = (v) => !!v.url && (!!v.thumb || isIg(v.url) || isTk(v.url));

export default function VideoGrid({ videos }) {
  const seen = new Set();
  const items = (videos || [])
    .filter(renderizavel)
    .filter((v) => { const k = (v.url || "").split("?")[0]; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);
  // Devolver null deixava a dobra "Proof" a desaparecer inteira, sem uma linha a dizer
  // porquê — o utilizador via um buraco e presumia página partida. Estado vazio explícito:
  // distingue "a Tubular não devolveu peças" de "há vídeos mas sem link/thumb utilizável".
  if (!items.length) {
    const total = (videos || []).length;
    return (
      <div className="panel sparkline-panel">
        <h3>Últimos vídeos <span>· leitura de cada peça</span></h3>
        <div className="forecast-cell">
          <div className="v" style={{ fontSize: 17, color: "var(--gold-bright)" }}>Sem peças para mostrar</div>
          <div className="k" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
            {total
              ? `${total} vídeo${total > 1 ? "s" : ""} registado${total > 1 ? "s" : ""}, mas nenhum com um link que se consiga mostrar (nem thumbnail gravada, nem URL de TikTok ou Instagram que o /api/thumb saiba resolver).`
              : "Nenhum vídeo sincronizado da Tubular para este creator — sem peças, o deep-scan também não tem o que analisar."}
            {" "}Corre o enriquecimento outra vez para tentar recolher os vídeos.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="panel sparkline-panel">
      <h3>Últimos vídeos <span>· leitura de cada peça</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> não é vitrine — cada vídeo vem com tema, formato e fit pra campanha. <b>Por que acompanhar:</b> a IA vira curadora, mostrando quais peças servem de molde pro produto.
      </div>
      <div className="vgrid">
        {items.map((v) => {
          const ins = insight(v);
          return (
            <div key={v.id} className="vgrid-item">
              <a href={v.url} target="_blank" rel="noopener noreferrer" className="vgrid-link">
                <img src={`/api/thumb?v=3&${v.thumb ? `u=${encodeURIComponent(v.thumb)}&` : ""}fb=${encodeURIComponent(v.url)}`} alt={v.title || ""} loading="lazy" />
                {v.views > 0 && <span className="vgrid-views">{fmt(v.views)} views</span>}
                <span className={`vgrid-ins ${ins.isHair ? "fit" : "nofit"}`}>
                  <span className="vgrid-ins-h">{ins.formato} · {ins.fit}</span>
                  <span className="vgrid-ins-s">{v.views > 0 ? `${fmt(v.views)} views · ` : ""}{ins.nota}</span>
                </span>
              </a>
              <AnalysisButton video={v} />
              <ChatButton video={v} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
