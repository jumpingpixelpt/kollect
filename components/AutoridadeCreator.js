import PainelPendente from "@/components/PainelPendente";
import { TAG_LABEL } from "@/lib/casting";

/**
 * PERFIL NO RADAR — a tag do creator (KOL / Rising Star / Pool) e a leitura do seu
 * território, sem nota.
 *
 * Feedback do cliente (set/2026, ponto 14): o Score KOL v1, os cinco fatores com peso e a
 * nota /100 saíram da ficha — "não podemos levar isso pro cliente". O motor continua a
 * correr (lib/kolscore.js): é ele que decide a tag, a elegibilidade e o deep-scan. O que se
 * mostra é o resultado em palavras: o que a creator é, e por que — com a evidência do
 * conteúdo dela, não com a régua de um briefing.
 *
 * "Autoridade social (proxy v1)" e "aderência de audiência" deram lugar, por decisão do
 * cliente, a uma análise de conversa (média de comentários, perguntas, respostas). Essa
 * análise ainda não existe — precisa do texto dos comentários, que não recolhemos — e por
 * isso não se promete aqui: aparece quando houver dado.
 */
const TAG_TEXTO = {
  kol: "Referência estabelecida do território: conteúdo concentrado no tema, com performance e autoridade acima dos pares.",
  rising_star: "Em aceleração: cresce acima do ritmo do território e ainda tem a base em construção — janela para contratar antes de o cachê subir.",
  pool: "Passa os cortes do território e entra no pool de candidatas — a decisão fica com a leitura da evidência abaixo.",
};

export default function AutoridadeCreator({ kolScore, tag, history, saturacao, satComercial, concorrentes, territorioLabel }) {
  const k = kolScore?.geral ?? null;

  if (!k) return (
    <PainelPendente titulo="Perfil no radar" sub="tag"
      passo="score (/api/kol-score)"
      nota="A tag (KOL, Rising Star ou Pool) sai da avaliação que corre depois do screening e do brand-scan." />
  );

  const nichos = (history?.nichos || []).filter((n) => n?.nicho).map((n) => ({ nicho: String(n.nicho).split(/[&/|,]/)[0].trim(), pct: Number(n.pct) || 0 })).sort((a, b) => b.pct - a.pct);
  const top = nichos[0] ?? null;
  // "especialista" vs "pulverizada" pela concentração do conteúdo, não por um briefing
  const leituraTerr = top
    ? top.pct >= 60
      ? `${top.nicho} é o território principal desta creator e representa ${Math.round(top.pct)}% dos conteúdos analisados — o tema aparece com frequência e consistência nas publicações recentes, indicando especialização nesse assunto.`
      : top.pct >= 35
        ? `${top.nicho} é o território com mais peso (${Math.round(top.pct)}% dos conteúdos analisados)${nichos[1] ? `, seguido de ${nichos[1].nicho} (${Math.round(nichos[1].pct)}%)` : ""} — produção repartida entre temas, sem um único foco dominante.`
        : `O conteúdo está pulverizado entre territórios${top ? ` — o maior, ${top.nicho}, fica em ${Math.round(top.pct)}% dos conteúdos analisados` : ""}; não há especialização clara num só tema.`
    : null;

  // recalculada na página, não a gravada no score — ver o comentário lá.
  // Desduplicada por marca: três produtos ("Elseve Colágeno Lifter", "Elseve Liso dos
  // Sonhos", "Óleo Elixir Ultime") resolvem para a mesma entrada e escreviam
  // "L'Oréal Paris / Elseve" três vezes na mesma linha.
  const conc = concorrentes || k.saturacao || null;
  const marcasDe = (lista) => [...new Set((lista || []).map((e) => e.marca))];
  const t = tag || "pool";

  return (
    <div className="panel">
      <h3>Perfil no radar <span>· {territorioLabel ?? "território"}</span></h3>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <span className={`fc-tag${t === "pool" ? " fc-tag-pool" : ""}`} style={{ fontSize: 13, padding: "6px 14px" }}>{TAG_LABEL[t]}</span>
        <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{TAG_TEXTO[t]}</span>
      </div>
      {k.kol_nao_avaliavel && (
        <p className="fc-why-nota">A tag KOL não pôde ser avaliada por falta de dados de audiência — não foi recusada.</p>
      )}

      {leituraTerr && <p className="fc-leitura">{leituraTerr}</p>}

      {satComercial && (
        <div className="fc-sat">
          <div className="fc-sat-h">
            <span title="Peças que declaram relação comercial (#publi, #ad, link comissionado, recebidos/press kit) sobre as peças do recorte.">Saturação comercial</span>
            {/* "com publicidade declarada" e não "são publi": a abreviatura lia-se como frase cortada (pedido de 03/09/2026) */}
            <b>{satComercial.publis} de {satComercial.total} peça{satComercial.total > 1 ? "s" : ""}{saturacao?.janela ? ` (${saturacao.janela})` : ""} com publicidade declarada</b>
          </div>
          <div className="fc-sat-bar"><span style={{ width: `${Math.min(100, satComercial.pct)}%` }} /></div>
          <div className="fc-sat-pct">{satComercial.pct}%</div>
        </div>
      )}

      {conc && conc.nivel !== "sem_dados" && (
        <div className="formula-note">
          Saturação de concorrentes: <b style={{ color: conc.nivel === "alta" ? "var(--red)" : conc.nivel === "media" ? "var(--gold-bright)" : "var(--green)" }}>{conc.nivel === "nenhuma" ? "nenhuma" : conc.nivel}</b>
          {conc.evidencias?.length ? ` — ${marcasDe(conc.evidencias).join(", ")} nos últimos ${conc.janela ?? "12m"}.` : " — nenhuma marca rival no histórico do último ano."}
          {conc.interna?.length ? ` Marcas do grupo L'Oréal (${marcasDe(conc.interna).join(", ")}) são contadas à parte e não somam.` : ""}
        </div>
      )}
    </div>
  );
}
