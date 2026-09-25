import PainelPendente from "@/components/PainelPendente";
import { r2 } from "@/lib/numeros";
// Painel de Audiência: demografia + popularidade (notáveis) + credibilidade + afinidade de marca.
// Cada número tem tooltip (title) e há uma leitura em texto por cima, pro cliente entender sem caçar.
export default function AudiencePanel({ audience }) {
  const a = audience;
  // A audiência passou a ser passo da cadeia (decisão do cliente, jul/2026 — automática nos
  // dois caminhos de entrada), portanto o ↻ Atualizar dados enche mesmo este painel. Durante
  // um bocado não enchia e o texto dizia que sim: eram três minutos de espera para nada.
  if (!a) return <PainelPendente titulo="Audiência" sub="credibilidade e perfil"
    passo="audiencia (/api/audience-refresh)"
    nota="Custa 1 crédito da influencers.club, só da primeira vez — quem já tem audiência não volta a ser comprado. Se a chave dela estiver recusada, não enche de maneira nenhuma: confirma em /api/ic-debug?credits=1, que não gasta créditos." />;
  // Consultado e sem resposta ≠ por consultar. Sem esta distinção o painel ficava vazio e
  // mudo, que se lê como falha da plataforma em vez de ausência na fonte.
  if (a.sem_dados) return <PainelPendente titulo="Audiência" sub="credibilidade e perfil" semFonte nota={`A influencers.club foi consultada${a.coletado_em ? ` em ${a.coletado_em}` : ""} e não tem dados de audiência para este perfil. Não é passo em falta na cadeia — repetir não traz nada. Consequência: autoridade e aderência ficam por medir no Score KOL, que sai parcial.`} />;
  const has = a.v === 2;

  const cell = (v, k, tip) => v == null ? null : (
    <div className="forecast-cell" key={k} title={tip} style={{ cursor: "help" }}>
      <div className="v">{r2(v)}%</div><div className="k">{k}</div>
    </div>
  );

  // leitura automática dos números
  const partes = [];
  if (a.mulheres_pct != null && a.faixa_18_45_pct != null) {
    partes.push(`público ${a.mulheres_pct >= 60 ? "majoritariamente feminino" : "misto"} (${r2(a.mulheres_pct)}% mulheres), ${r2(a.faixa_18_45_pct)}% na faixa 18–45${a.brasil_pct != null ? ` e ${r2(a.brasil_pct)}% no Brasil` : ""}`);
  }
  if (has && a.notaveis_pct != null) {
    const t = a.notaveis_pct >= 30 ? "popularidade ALTA entre contas influentes" : a.notaveis_pct >= 15 ? "popularidade moderada entre pares" : "poucos seguidores influentes";
    partes.push(`${r2(a.notaveis_pct)}% da audiência são contas notáveis — ${t}`);
  }
  if (has && a.credibilidade_pct != null) {
    const t = a.credibilidade_pct >= 70 ? "audiência real e limpa" : a.credibilidade_pct >= 50 ? "credibilidade ok" : "credibilidade baixa — sinais de bots/inativos";
    partes.push(`${r2(a.credibilidade_pct)}% é ${t}`);
  }
  const leitura = partes.length ? partes.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : null;

  return (
    <div className="panel">
      <h3>Audiência <span>· quem segue</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> o perfil de quem segue a creator — demografia, popularidade entre contas influentes, credibilidade da base e as marcas que essa audiência já curte.
        <b> Por que acompanhar:</b> diz se a audiência é o público da marca, se é gente real e de peso.
      </div>

      {leitura && (
        <div className="transcript" style={{ fontStyle: "normal", marginBottom: 16, borderLeft: "2px solid var(--gold)", paddingLeft: 12 }}>
          {leitura}
        </div>
      )}

      <div className="forecast-grid" style={{ marginBottom: 14 }}>
        {has && cell(a.notaveis_pct, "Audiência notável · contas influentes", "% dos seguidores que são contas notáveis/influentes (grandes ou verificadas). Quanto maior, mais a creator é seguida por gente de peso — autoridade entre pares. Acima de ~30% é alto.")}
        {has && cell(a.credibilidade_pct, "Credibilidade · audiência real", "% da audiência considerada real e ativa (anti-bot). ≥70% é saudável; abaixo de 50% acende alerta de seguidores falsos ou inativos.")}
        {cell(a.mulheres_pct, "Mulheres", "% da audiência que é feminina. Alvo do cliente (beauty): ≥55%.")}
        {cell(a.faixa_18_45_pct, "18–45 anos", "% da audiência na faixa de 18 a 45 anos — o público de consumo do cliente. Alvo: ≥55%.")}
        {cell(a.brasil_pct, "Brasil", "% da audiência localizada no Brasil. Alvo: ≥70%.")}
      </div>

      {a.marcas_afinidade?.length > 0 && (
        <>
          <div className="formula-note" style={{ marginBottom: 8 }} title="Marcas que aparecem com mais força entre os interesses da audiência dela. Útil pra argumentar fit: se a audiência já curte marcas do segmento, a porta está aberta.">Marcas que a audiência dela já segue:</div>
          <div className="chips" style={{ marginBottom: a.interesses?.length ? 12 : 0 }}>
            {a.marcas_afinidade.map((m) => <span className="chip-sm" key={m}>{m}</span>)}
          </div>
        </>
      )}
      {a.interesses?.length > 0 && (
        <div className="chips">
          {a.interesses.map((i) => <span className="chip-sm" key={i} style={{ opacity: 0.7 }}>{i}</span>)}
        </div>
      )}
      {!has && <div className="formula-note">Popularidade e afinidade de marca ainda não coletadas — atualize os dados.</div>}
    </div>
  );
}
