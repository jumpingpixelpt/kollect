import PainelPendente from "@/components/PainelPendente";

/**
 * CONVERSA COM A COMUNIDADE — a leitura que substitui "autoridade social (proxy v1)" e
 * "aderência de audiência" na ficha (feedback do cliente, set/2026, ponto 14).
 *
 * Duas camadas, e a página diz qual tem: o VOLUME sai das peças do banco e é grátis
 * (média de comentários, comparação com a faixa, consistência); o CONTEÚDO — perguntas,
 * pedidos de recomendação, respostas da creator — vem de uma amostra de comentários lida
 * no Apify (/api/conversa), e só existe para quem passou o corte ou para quem alguém pediu.
 */
const fmt = (n) => (n == null ? "—" : n >= 1e3 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k` : String(Math.round(n)));

export default function ConversaComunidade({ conversa }) {
  const vol = conversa?.volume;
  if (!vol) return (
    <PainelPendente titulo="Conversa com a comunidade" sub="comentários"
      passo="conversa (/api/conversa)"
      nota="Mede se a audiência trata a creator como fonte: comentários por peça face à faixa, dúvidas e pedidos, e se ela responde." />
  );
  const cont = conversa.conteudo;
  const nivel = vol.indice_faixa == null ? null : vol.indice_faixa >= 1.5 ? ["alta", "alto"] : vol.indice_faixa >= 0.8 ? ["na média", "medio"] : ["baixa", "baixo"];

  const Cel = ({ v, k, cor }) => (
    <div className="fc-rede-c" style={{ minWidth: 120 }}>
      <b style={cor ? { color: cor } : undefined}>{v}</b>
      <i>{k}</i>
    </div>
  );

  return (
    <div className="panel">
      <h3>Conversa com a comunidade <span>· comentários</span></h3>
      {conversa.leitura && <p className="fc-leitura">{conversa.leitura}</p>}

      <div className="fc-rede" style={{ marginBottom: 0 }}>
        <Cel v={fmt(vol.media_comentarios)} k="Comentários por peça" />
        <Cel v={vol.mediana_faixa != null ? fmt(vol.mediana_faixa) : "—"} k={`Mediana da faixa ${vol.faixa}`} />
        <Cel v={vol.indice_faixa != null ? `${vol.indice_faixa}×` : "—"} k="Face à faixa" cor={nivel ? (nivel[1] === "alto" ? "var(--green)" : nivel[1] === "baixo" ? "var(--red)" : undefined) : undefined} />
        <Cel v={vol.por_1k_seguidores != null ? `${vol.por_1k_seguidores}` : "—"} k="Por 1k seguidores" />
        <Cel v={vol.consistencia != null ? `${vol.consistencia}%` : "—"} k="Consistência entre peças" />
        {cont && <Cel v={cont.pct_duvidas != null ? `${cont.pct_duvidas}%` : "—"} k="Dúvidas e pedidos" />}
        {cont && <Cel v={cont.taxa_resposta != null ? `${cont.taxa_aproximada ? "≈" : ""}${cont.taxa_resposta}%` : "—"} k="Respondidas pela creator" />}
      </div>

      {cont?.exemplos?.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="fc-rede-sec" style={{ margin: "0 0 6px" }}>Exemplos de dúvidas lidas</div>
          {cont.exemplos.map((e, i) => <div className="fc-risk-ev" key={i}>“{e}”</div>)}
        </div>
      ) : null}

      <div className="formula-note">
        Volume sobre {vol.pecas} peça{vol.pecas > 1 ? "s" : ""} do banco{vol.n_faixa ? `, comparado com ${vol.n_faixa} creators da faixa ${vol.faixa}` : ""}.
        {cont
          ? ` Conteúdo sobre ${cont.comentarios_lidos} comentários${cont.respostas_lidas ? ` e ${cont.respostas_lidas} respostas` : ""} lidos em ${conversa.amostra?.pecas?.length ?? "—"} peça${(conversa.amostra?.pecas?.length ?? 0) > 1 ? "s" : ""}${conversa.amostra?.em ? ` (${conversa.amostra.em})` : ""}.`
          : " Perguntas e respostas ainda não lidas — corre ↻ Atualizar dados."}
      </div>
    </div>
  );
}
