"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ordenarConteudos } from "@/lib/creator-insights";
import { r2 } from "@/lib/numeros";
import { avatarSrc } from "@/lib/avatar-src";
import styles from "./CreatorHubInsights.module.css";

const PASSO = 12;
const REDES = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };
const METRICAS = [
  ["comments", "Comentários", "comentários"],
  ["saves", "Saves", "salvamentos"],
  ["shares", "Shares", "compartilhamentos"],
];
const numero = (n) => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n) >= 1e6
  ? `${r2(Number(n) / 1e6).toLocaleString("pt-BR")}M`
  : Number(n) >= 1e3 ? `${r2(Number(n) / 1e3).toLocaleString("pt-BR")}k`
    : Math.round(Number(n)).toLocaleString("pt-BR");
const taxa = (n) => n == null || !Number.isFinite(Number(n)) ? "—" : `${r2(Number(n)).toLocaleString("pt-BR")}%`;
const redeNome = (rede) => REDES[rede] || rede || "Rede não informada";
const handle = (value) => String(value || "").replace(/^@+/, "");

function dia(value) {
  if (!value) return "Data não informada";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "Data não informada" : date.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function linkOriginal(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function Avatar({ creator }) {
  const [falhou, setFalhou] = useState(false);
  const name = handle(creator.handle) || creator.name || "Creator";
  // foto durável por id (lib/avatar-src.js, B4 set/2026); morta → inicial
  const src = avatarSrc(creator.avatar_url, creator.id);
  return src && !falhou ? (
    <img className={styles.avatar} src={src}
      width={56} height={56} alt="" onError={() => setFalhou(true)} />
  ) : <span className={`${styles.avatar} ${styles.initial}`} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

function Miniatura({ video }) {
  const [falhou, setFalhou] = useState(false);
  const original = linkOriginal(video.url);
  if (falhou || !(video.thumb || original)) {
    return (
      <span className={styles.noImage}>
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" />
        </svg>
        <span>{falhou ? "Miniatura indisponível na origem" : "Miniatura não disponível"}</span>
        {original && <small>Abra a publicação original ↗</small>}
      </span>
    );
  }
  return <img src={`/api/thumb?v=3&sf=1&${video.thumb ? `u=${encodeURIComponent(video.thumb)}&` : ""}fb=${encodeURIComponent(original || "")}`}
    alt="" loading="lazy" decoding="async" onError={() => setFalhou(true)} />;
}

export function Conteudo({ video, rank, mood }) {
  const original = linkOriginal(video.url);
  const Elemento = original ? "a" : "div";
  const titulo = video.title?.trim() || "Publicação sem legenda disponível";
  const imagem = video.tipo && video.tipo !== "video";
  return (
    <article className={`${styles.contentCard} ${mood ? styles.moodCard : ""}`}>
      <Elemento className={styles.contentLink} {...(original ? { href: original, target: "_blank", rel: "noopener noreferrer" } : {})}>
        <div className={styles.media}>
          <Miniatura key={`${video.id}-${video.thumb || video.url}`} video={video} />
          {rank != null && <span className={styles.rank}><span className={styles.srOnly}>Posição </span>{String(rank).padStart(2, "0")}</span>}
          <div className={styles.mediaTags}>
            <span>{redeNome(video.platform)}{imagem ? ` · ${video.tipo === "imagem" ? "Foto / carrossel" : video.tipo}` : ""}</span>
            {video.publi && <span>Publi</span>}
          </div>
        </div>
        <div className={styles.contentBody}>
          <div className={styles.contentDate}>
            <time dateTime={video.posted_at || undefined}>{dia(video.posted_at)}</time>
            {original && <span aria-hidden="true">↗</span>}
          </div>
          <h4 className={styles.contentTitle}>{titulo}</h4>
          {!mood && <>
            <dl className={styles.cardMetrics}>
              <div><dt>Views</dt><dd>{numero(video.views)}</dd></div>
              <div><dt>E.R.</dt><dd>{taxa(video.engagementRate)}</dd></div>
            </dl>
            <dl className={styles.cardDetails}>
              <div><dt>Comentários</dt><dd>{numero(video.comments)}</dd></div>
              <div><dt>Saves</dt><dd>{numero(video.saves)}</dd></div>
              <div><dt>Shares</dt><dd>{numero(video.shares)}</dd></div>
            </dl>
          </>}
          {original ? <span className={styles.srOnly}>Abrir publicação original em nova aba</span>
            : <span className={styles.missingLink}>Link original indisponível</span>}
        </div>
      </Elemento>
    </article>
  );
}

/**
 * Peças montáveis em separado (feedback rodada 2, F3.3/F3.4, set/2026): as abas do Hub
 * saíram e a ficha do creator passou a desenhar, em rolo, o Top Conteúdos, o Mood Board e a
 * nuvem de palavras como secções próprias (components/PerfilRolo.js). Os dados são os
 * mesmos de lib/creator-insights.js; quem monta decide se partilham o tema escolhido.
 */

/**
 * Nuvem de palavras. `fonte` (lib/creator-insights.js, F3.4 rodada 2) diz de onde vieram os
 * temas: "analise" — a análise de IA dos vídeos da janela; "analise_antiga" — a mesma
 * análise, de peças anteriores aos 90 dias; "legendas" — legenda + transcrição, quando não há
 * análise nenhuma (o aviso «baseado nas legendas» é pedido do cliente). A transcrição nunca
 * chega aqui: só os termos já contados.
 */
export function NuvemPalavras({ topics = [], total = 0, textMeasured = 0, analisadas = 0, fonte = "legendas", tema = "", onTema, controla, titulo = "O que aparece no conteúdo" }) {
  const maxTema = Math.max(1, ...topics.map((topic) => topic.count));
  const temaAtivo = topics.find((topic) => topic.term === tema);
  const pelaAnalise = fonte === "analise" || fonte === "analise_antiga";
  const pecas = (n) => `${n} ${n === 1 ? "publicação analisada" : "publicações analisadas"}`;
  return (
    <section className={styles.topics} aria-label="Nuvem de temas das publicações">
      <div className={styles.sectionHead}>
        <div><h3>{titulo}</h3><p>{pelaAnalise
          ? "Temas do nicho identificados pela análise de IA dos vídeos. Quanto maior a palavra, mais publicações tratam do tema."
          : "Temas dos textos disponíveis. Quanto maior a palavra, mais publicações a mencionam."}</p></div>
        {temaAtivo && onTema && <button type="button" className={styles.clearButton} onClick={() => onTema("")}>Limpar tema <span aria-hidden="true">×</span></button>}
      </div>
      {topics.length ? <div className={styles.wordCloud}>
        {topics.map((topic) => <button type="button" key={topic.term} className={styles.topic}
          style={{ "--topic-size": `${14 + 18 * Math.sqrt(topic.count / maxTema)}px` }}
          aria-pressed={temaAtivo?.term === topic.term} aria-controls={onTema ? controla : undefined} disabled={!onTema}
          aria-label={`${topic.term}: ${topic.count} ${topic.count === 1 ? "publicação" : "publicações"}${onTema ? ". Filtrar galeria" : ""}`}
          onClick={() => onTema?.(tema === topic.term ? "" : topic.term)}>
          {topic.term}<small>{topic.count}</small>
        </button>)}
      </div> : <p className={styles.emptyTopics}>Ainda não há texto suficiente para mostrar temas recorrentes neste período.</p>}
      <p className={styles.note}>{fonte === "analise"
        ? `Baseado na análise de IA de ${pecas(analisadas)} dos últimos 90 dias (de ${total} no período).`
        : fonte === "analise_antiga"
          ? `Baseado na análise de IA de ${pecas(analisadas)}, anteriores aos últimos 90 dias — nenhuma publicação do período foi analisada ainda.`
          : `Baseado nas legendas: nenhuma publicação deste perfil tem análise de IA ainda. ${textMeasured} de ${total} publicações com texto disponível.`}
        {topics.length && onTema ? " Clique em um tema para ver as publicações correspondentes." : ""}</p>
    </section>
  );
}

/**
 * Galeria em dois modos: "top" (ranking por views ou E.R., com números) e "mood" (mosaico
 * das peças, mais recentes primeiro, sem números). Rede, ordem e paginação são estado
 * próprio; o tema vem de fora, para a nuvem de palavras o poder escolher.
 */
export function Galeria({ videos = [], topics = [], mood = false, tema = "", onTema, id }) {
  const [rede, setRede] = useState("");
  const [ordem, setOrdem] = useState("views");
  const [limite, setLimite] = useState(PASSO);
  const redes = useMemo(() => [...new Set(videos.map((video) => video.platform).filter(Boolean))], [videos]);
  const temaAtivo = topics.find((topic) => topic.term === tema);
  const filtrados = useMemo(() => {
    const ids = temaAtivo ? new Set(temaAtivo.videoIds.map(String)) : null;
    return videos.filter((video) => (!rede || video.platform === rede) && (!ids || ids.has(String(video.id))));
  }, [videos, rede, temaAtivo]);
  const lista = useMemo(() => mood
    ? [...filtrados].sort((a, b) => String(b.posted_at || "").localeCompare(String(a.posted_at || "")) || String(a.id).localeCompare(String(b.id)))
    : ordenarConteudos(filtrados, ordem), [filtrados, mood, ordem]);
  const semMetrica = mood ? 0 : filtrados.length - lista.length;

  return (
    <section className={styles.gallerySection} id={id} aria-label={mood ? "Mood Board do creator" : "Top conteúdos do creator"}>
      <div className={styles.galleryHead}>
        <div><h3>{mood ? "Mood Board" : "Top Conteúdos do Creator"}</h3><p>{mood
          ? "Um compilado do perfil em imagens, das publicações mais recentes às mais antigas."
          : "Desempenho das publicações dos últimos 90 dias, por visualizações ou taxa de engajamento."}</p></div>
        <div className={styles.filters}>
          <label><span>Rede</span><select value={rede} onChange={(event) => { setRede(event.target.value); setLimite(PASSO); }}>
            <option value="">Todas as redes</option>
            {redes.map((item) => <option key={item} value={item}>{redeNome(item)}</option>)}
          </select></label>
          {!mood && <label><span>Ordenar por</span><select value={ordem} onChange={(event) => { setOrdem(event.target.value); setLimite(PASSO); }}>
            <option value="views">Mais visualizações</option>
            <option value="engagementRate">Maior E.R.</option>
          </select></label>}
        </div>
      </div>
      {temaAtivo && <div className={styles.activeFilter}>
        <span>Publicações sobre <strong>{temaAtivo.term}</strong></span>
        {onTema && <button type="button" onClick={() => onTema("")} aria-label={`Remover filtro do tema ${tema}`}>Remover <span aria-hidden="true">×</span></button>}
      </div>}
      <div className={styles.galleryStatus} role="status">{lista.length} {lista.length === 1 ? "publicação" : "publicações"}{mood ? " no mood board" : " no ranking"}{temaAtivo || rede ? " com estes filtros" : " no período"}</div>
      {lista.length ? <div className={mood ? styles.moodGrid : styles.contentGrid}>
        {lista.slice(0, limite).map((video, index) => <Conteudo key={video.id} video={video} mood={mood} rank={mood ? null : index + 1} />)}
      </div> : <div className={styles.empty}>
        <h4>{!videos.length ? "Nenhuma publicação disponível neste período" : !filtrados.length ? "Nenhuma publicação com estes filtros" : "Sem métricas para este ranking"}</h4>
        <p>{!videos.length ? "As médias, os temas e as imagens aparecem quando há publicações disponíveis nos últimos 90 dias."
          : !filtrados.length ? "Escolha outra rede ou remova o tema para explorar as publicações disponíveis."
            : `Não há ${ordem === "views" ? "visualizações" : "taxa de engajamento"} medidas para ordenar estas publicações. As peças disponíveis podem ser vistas no Mood Board.`}</p>
        {(rede || temaAtivo) && <button type="button" className={styles.clearButton} onClick={() => { setRede(""); onTema?.(""); setLimite(PASSO); }}>Limpar filtros</button>}
      </div>}
      {lista.length > limite && <button type="button" className={styles.showMore} onClick={() => setLimite((value) => value + PASSO)}>
        Mostrar mais {Math.min(PASSO, lista.length - limite)} publicações <span aria-hidden="true">↓</span>
      </button>}
      {!mood && <p className={styles.note}>E.R. = (curtidas + comentários + saves + shares disponíveis) ÷ visualizações. Sem visualizações, a taxa não é calculada.
        {semMetrica > 0 ? ` ${semMetrica} ${semMetrica === 1 ? "publicação sem a métrica selecionada fica" : "publicações sem a métrica selecionada ficam"} fora deste ranking.` : ""}</p>}
    </section>
  );
}

/**
 * Mood Board da ficha (feedback rodada 2, F3.4 — set/2026): «compilado do perfil em
 * imagens», SÓ imagens — sem legenda, sem data, sem números (esses ficam no Top conteúdos).
 * Mosaico em colunas (masonry por CSS columns), cada miniatura abre a publicação original.
 * `videos` são as peças dos últimos 90 dias; sem nenhuma, `reserva` (as últimas 24 de
 * sempre), para um perfil parado há meses não ficar sem mood board. Miniatura que falha na
 * origem some do mosaico em vez de deixar um buraco com aviso.
 */
function TileMood({ video }) {
  const [falhou, setFalhou] = useState(false);
  const original = linkOriginal(video.url);
  if (falhou || !(video.thumb || original)) return null;
  const Elemento = original ? "a" : "div";
  return (
    <Elemento className={styles.moodTile} {...(original ? { href: original, target: "_blank", rel: "noopener noreferrer", "aria-label": `Abrir publicação de ${dia(video.posted_at)} em nova aba` } : {})}>
      <img src={`/api/thumb?v=3&sf=1&${video.thumb ? `u=${encodeURIComponent(video.thumb)}&` : ""}fb=${encodeURIComponent(original || "")}`}
        alt="" loading="lazy" decoding="async" onError={() => setFalhou(true)} />
    </Elemento>
  );
}

export function MoodBoard({ videos = [], reserva = [], id }) {
  const [limite, setLimite] = useState(24);
  const usaReserva = !videos.length && reserva.length > 0;
  const lista = useMemo(() => (usaReserva ? reserva : videos).filter((video) => video.thumb || linkOriginal(video.url)),
    [videos, reserva, usaReserva]);
  return (
    <section className={styles.gallerySection} id={id} aria-label="Mood Board do creator">
      <div className={styles.galleryHead}>
        <div><h3>Mood Board</h3><p>{usaReserva
          ? "Um compilado do perfil em imagens — as últimas publicações importadas (nenhuma nos últimos 90 dias)."
          : "Um compilado do perfil em imagens, das publicações dos últimos 90 dias."} Clique numa imagem para abrir a publicação.</p></div>
      </div>
      {lista.length ? <div className={styles.moodMasonry}>
        {lista.slice(0, limite).map((video) => <TileMood key={`${video.creator_id}-${video.id}`} video={video} />)}
      </div> : <div className={styles.empty}>
        <h4>Nenhuma imagem disponível</h4>
        <p>As miniaturas aparecem aqui depois do enriquecimento do perfil.</p>
      </div>}
      {lista.length > limite && <button type="button" className={styles.showMore} onClick={() => setLimite((value) => value + 24)}>
        Mostrar mais imagens <span aria-hidden="true">↓</span>
      </button>}
    </section>
  );
}

// Vista completa (cabeçalho + médias + nuvem + galeria), como era nas abas do Hub. Sem
// consumidor desde set/2026 — fica para quem precisar do bloco inteiro num sítio só.
function Insights({ data, view }) {
  const [tema, setTema] = useState("");
  const galleryId = useId();
  const creator = data.creator;
  const videos = data.videos || [];
  const conta = handle(creator.handle);
  const contas = creator.accounts || [];
  const total = data.coverage?.total ?? videos.length;

  return (
    <div className={styles.insights}>
      <header className={styles.creatorHeader}>
        <div className={styles.identity}>
          <Avatar creator={creator} />
          <div className={styles.identityText}>
            <span className={styles.eyebrow}>Conteúdo do creator</span>
            <h2>{conta ? `@${conta}` : creator.name || "Creator"}</h2>
            <p>{creator.name && creator.name !== conta ? `${creator.name} · ` : ""}{redeNome(creator.platform)}</p>
          </div>
        </div>
        {creator.id && <Link className={styles.profileLink} href={`/creator/${encodeURIComponent(creator.id)}`}>Ver ficha completa <span aria-hidden="true">↗</span></Link>}
        <div className={styles.period}>
          <span>Últimos {data.window?.days || 90} dias</span>
          {data.window?.start && data.window?.end && <span>{dia(data.window.start)} — {dia(data.window.end)}</span>}
        </div>
      </header>

      <section className={styles.overview} aria-label="Médias de interações por publicação">
        <div className={styles.sectionHead}>
          <div><h3>Interações por publicação</h3><p>Médias das publicações com cada métrica disponível, nas contas vinculadas.</p></div>
          <span className={styles.consolidated}>Consolidado · todas as redes</span>
        </div>
        <dl className={styles.metrics}>
          {METRICAS.map(([key, label, description]) => {
            const metric = data.metrics?.[key];
            const medido = Number(metric?.measured || 0);
            const base = metric?.total ?? total;
            const disponivel = medido > 0 && metric?.average != null;
            return <div className={styles.metric} key={key}>
              <dt>{label} <span>média por publicação</span></dt>
              <dd className={styles.metricNumber} aria-label={disponivel ? `${numero(metric.average)} ${description} por publicação` : `Sem dados de ${description}`}>
                {disponivel ? numero(metric.average) : "—"}
              </dd>
              <dd className={styles.metricCoverage}>{disponivel ? `${medido} de ${base} publicações com medição` : `Sem medição · 0 de ${base} publicações`}</dd>
            </div>;
          })}
        </dl>
        <p className={styles.note}>Ausências não entram na média; zero medido entra. {contas.length > 1
          ? `${contas.length} contas vinculadas neste consolidado.`
          : "Somente publicações dentro do período."}</p>
      </section>

      <NuvemPalavras topics={data.topics || []} total={total} textMeasured={data.coverage?.textMeasured ?? 0}
        tema={tema} onTema={setTema} controla={galleryId} />
      <Galeria key={view} id={galleryId} videos={videos} topics={data.topics || []} mood={view === "mood"} tema={tema} onTema={setTema} />
    </div>
  );
}

export default function CreatorHubInsights({ data, view = "top" }) {
  if (!data?.creator) return <div className={styles.empty}><h3>Selecione um creator</h3><p>Explore suas publicações, interações e temas dos últimos 90 dias.</p></div>;
  return <Insights key={data.creator.id || data.creator.handle} data={data} view={view} />;
}
