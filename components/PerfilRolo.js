"use client";
import { useCallback, useState } from "react";
import { Conteudo, Galeria, MoodBoard, NuvemPalavras } from "./CreatorHubInsights";
import styles from "./PerfilRolo.module.css";
import hub from "./CreatorHubInsights.module.css";

/**
 * O miolo da ficha em rolo (feedback rodada 2, F3.4, set/2026): Últimos 6 posts → Top
 * conteúdos → Mood Board → Nuvem de palavras + Principais hashtags, cada um com a sua âncora
 * (#posts, #top, #mood, #palavras) para o índice fixo do topo da ficha.
 *
 * Nada é pedido ao servidor daqui: os dados chegam já calculados pela página
 * (lib/creator-insights.js sobre os vídeos que a ficha já leu de todas as contas ligadas) —
 * a ficha antiga das abas do Hub fazia outra ronda a /api/creator-insights para as mesmas
 * peças. A nuvem e o Top partilham o tema: clicar numa palavra filtra o ranking e sobe
 * até ele. `hashtags` é o painel de servidor (components/Hashtags.js), passado já desenhado.
 */
export default function PerfilRolo({ ultimos = [], recentes = [], insights = null, hashtags = null }) {
  const [tema, setTema] = useState("");
  const videos = insights?.videos || [];
  const topics = insights?.topics || [];
  const total = insights?.coverage?.total ?? videos.length;

  const escolherTema = useCallback((t) => {
    setTema(t);
    if (t) document.getElementById("top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <section id="posts" className={styles.secao} aria-labelledby="posts-h">
        <div className={styles.cabeca}>
          <h2 id="posts-h">Últimos posts</h2>
          <p>As 6 publicações mais recentes, em todas as redes ligadas ao perfil.</p>
        </div>
        {ultimos.length
          ? <div className={hub.contentGrid}>{ultimos.map((v) => <Conteudo key={`${v.creator_id}-${v.id}`} video={v} />)}</div>
          : <div className={hub.empty}><h4>Nenhuma publicação importada</h4><p>As peças aparecem aqui depois do enriquecimento do perfil.</p></div>}
      </section>

      <div id="top" className={styles.secao}>
        <Galeria id="top-galeria" videos={videos} topics={topics} tema={tema} onTema={setTema} />
      </div>

      <div id="mood" className={styles.secao}>
        {/* o Mood Board não segue o tema da nuvem: é o compilado do perfil inteiro, só em
            imagens (F3.4). Sem peças nos 90 dias, as últimas 24 de sempre (`recentes`). */}
        <MoodBoard id="mood-galeria" videos={videos} reserva={recentes} />
      </div>

      <section id="palavras" className={styles.secao} aria-label="Nuvem de palavras e principais hashtags">
        <div className={styles.lado}>
          {/* análises antigas (fora dos 90 dias) descrevem o nicho mas não filtram o Top, que é
              da janela: aí a nuvem não é clicável */}
          <NuvemPalavras titulo="Nuvem de palavras" topics={topics} total={total} fonte={insights?.topicsFonte || "legendas"}
            analisadas={insights?.coverage?.analisadas ?? 0}
            textMeasured={insights?.coverage?.textMeasured ?? 0} tema={tema}
            onTema={insights?.topicsFonte === "analise_antiga" ? undefined : escolherTema} controla="top-galeria" />
          <div className={styles.hashtags}>{hashtags}</div>
        </div>
      </section>
    </>
  );
}
