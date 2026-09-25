import PainelPendente from "@/components/PainelPendente";

/**
 * TÓPICOS DE CONTEÚDO — a distribuição do conteúdo pelos territórios do radar, como a IA a
 * leu no brand-scan.
 *
 * A percentagem vem com a BASE ao lado. Sete territórios empatados a 11% não são sete
 * medidas: são uma peça em cada, numa amostra de nove — e a percentagem sozinha veste de
 * precisão o que é contagem pequena.
 *
 * No lugar do bloco "O que é / Por que acompanhar" (feedback do cliente, set/2026, ponto 16)
 * entra uma leitura do próprio dado: especialista ou pulverizada, e em quê.
 */
/** A mesma pergunta que decide se este painel tem corpo — a página usa-a para ajustar o par. */
export const temTopicos = (history) => (history?.nichos || []).some((n) => n?.nicho);

export default function TopicosConteudo({ history }) {
  const nichos = (history?.nichos || []).filter((n) => n?.nicho);
  if (!nichos.length) return (
    <PainelPendente titulo="Tópicos de conteúdo" sub="leitura da IA"
      passo="brand-scan (/api/brand-scan)"
      nota="É o brand-scan que lê legendas e falas e distribui o conteúdo pelos territórios do radar." />
  );

  const base = history.videos_analisados ?? null;
  const sub = history.sub_nichos || [];
  const formatos = history.formatos || [];
  const max = Math.max(...nichos.map((n) => Number(n.pct) || 0), 1);
  const ord = [...nichos].sort((a, b) => (Number(b.pct) || 0) - (Number(a.pct) || 0));
  const top = ord[0];
  const pct = Number(top.pct) || 0;
  const leitura = pct >= 60
    ? `${top.nicho} concentra ${Math.round(pct)}% dos conteúdos analisados — creator especialista, com o tema a aparecer de forma recorrente nas publicações.`
    : pct >= 35
      ? `${top.nicho} lidera com ${Math.round(pct)}%${ord[1] ? `, e ${ord[1].nicho} segue com ${Math.round(Number(ord[1].pct) || 0)}%` : ""} — produção repartida entre dois ou três temas.`
      : `Conteúdo pulverizado: nenhum território passa de ${Math.round(pct)}% das peças analisadas.`;

  return (
    <div className="panel">
      <h3>Tópicos de conteúdo <span>· leitura da IA</span></h3>
      <p className="fc-leitura">{leitura}</p>

      {nichos.map((n) => (
        <div className="pillar" key={n.nicho}>
          <div className="row">
            <span>{n.nicho}</span>
            <b>{n.pct}%{base ? <i className="fc-base"> · ~{Math.round(((Number(n.pct) || 0) / 100) * base)} de {base}</i> : null}</b>
          </div>
          <div className="track"><div className="fill" style={{ width: `${((Number(n.pct) || 0) / max) * 100}%` }} /></div>
        </div>
      ))}

      {sub.length > 0 && (
        <div className="chips" style={{ marginTop: 16 }}>
          {sub.map((s) => {
            const l = typeof s === "string" ? s : (s?.nome || s?.sub_nicho);
            return l ? <span className="chip-sm" key={l}>{l}</span> : null;
          })}
        </div>
      )}
      {formatos.length > 0 && (
        <div className="chips">
          {formatos.map((f) => {
            const l = typeof f === "string" ? f : (f?.nome || f?.formato);
            return l ? <span className="chip-sm" key={l} style={{ color: "var(--text-faint)" }}>◦ {l}</span> : null;
          })}
        </div>
      )}

      {base ? (
        <div className="formula-note">
          Distribuição sobre {base} peça{base > 1 ? "s" : ""} analisada{base > 1 ? "s" : ""}
          {history.escaneado_em ? ` em ${new Date(history.escaneado_em + "T12:00:00").toLocaleDateString("pt-BR")}` : ""} — com amostra pequena, leia a ordem e não a casa decimal.
        </div>
      ) : null}
    </div>
  );
}
