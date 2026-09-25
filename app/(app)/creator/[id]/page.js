import Link from "next/link";
import { supabaseServer as supabase } from "@/lib/supabase";
import { sessionRole, veCampanha } from "@/lib/auth-server";
import ScoreAvatar from "@/components/ScoreAvatar";
import EnrichButton from "@/components/EnrichButton";
import AddToList from "@/components/AddToList";
import LigarConta from "@/components/LigarConta";
import AutoridadeCreator from "@/components/AutoridadeCreator";
import ScorecardRedes from "@/components/ScorecardRedes";
import ConversaComunidade from "@/components/ConversaComunidade";
import TopicosConteudo, { temTopicos } from "@/components/TopicosConteudo";
import MarcasColaborou from "@/components/MarcasColaborou";
import DisasterCheck from "@/components/DisasterCheck";
import AnaliseDiarizada from "@/components/AnaliseDiarizada";
import ConteudosGrid from "@/components/ConteudosGrid";
import Hashtags from "@/components/Hashtags";
import BriefingMatch from "@/components/BriefingMatch";
import BigNumbers from "@/components/BigNumbers";
import PerfilRolo from "@/components/PerfilRolo";
import rolo from "@/components/PerfilRolo.module.css";
import { buildCreatorInsights } from "@/lib/creator-insights";
import { engDaPeca } from "@/lib/scorecard";
import { engRateViews } from "@/lib/engagement";
import { CLIENTS, DEFAULT_CLIENT } from "@/lib/clients";
import { territorioDe, TERRITORIO_LABEL } from "@/lib/territorio";
import { scorecardRede } from "@/lib/scorecard";
import { disasterCheck } from "@/lib/disaster";
import { saturacaoPubli } from "@/lib/publi";
import { saturacaoConcorrentes } from "@/lib/kolscore";
import { diaCurto } from "@/lib/datas";
import { CONCEITO } from "@/lib/conceitos";
import { tagDaFicha, TAG_LABEL } from "@/lib/casting";
import { fetchCreatorDetail, contentVideosForClient } from "@/lib/creator-detail";

export const revalidate = 30;

/**
 * FICHA DO CREATOR — estrutura nova (set/2026): autoridade, scorecard por rede, territórios
 * e marcas, disaster check, análise diarizada, conteúdos e briefing match.
 *
 * A ficha ficou ENXUTA por decisão de produto: cachê, forecast, curvas de tração, plano de
 * contratação, comparáveis, squad fit, dossiê executivo e chat saíram desta página. Os
 * componentes continuam no repo e ligados às suas rotas — nada foi apagado, e voltar a
 * pendurar qualquer um deles é uma linha de import.
 *
 * Feedback do cliente (set/2026, pontos 13–18): o Score KOL continua a ser calculado
 * (lib/kolscore.js decide elegibilidade e deep-scan), mas NÃO se mostra — nem no anel, nem
 * em painel. O que se mostra é a tag (KOL / Rising Star / Pool) e evidência: scorecard,
 * territórios, marcas, disaster check. Saíram também "última leitura", "% em 30 dias" e o
 * CRM. Os blocos "O que é / Por que acompanhar" deram lugar a leituras automáticas dos dados.
 *
 * Rodada 2 de feedback (F3.4, set/2026): a ficha é um rolo só, com índice fixo de atalhos
 * no topo — Perfil (com big numbers logo a seguir ao nome) → Últimos 6 posts → Top
 * conteúdos → Mood Board → Nuvem de palavras + Principais hashtags → "Análise completa"
 * (tudo o que já existia). O Top e o Mood Board vieram das abas do Hub (F3.3); os dados
 * saem dos vídeos que esta página já lê, sem query nova.
 */
const ATALHOS = [
  ["perfil", "Perfil"], ["posts", "Últimos posts"], ["top", "Top conteúdos"],
  ["mood", "Mood Board"], ["palavras", "Palavras e hashtags"], ["analise", "Análise"],
];
const NOME_REDE = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
const pct = (x) => (x == null ? null : `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

/**
 * Big numbers do perfil, todos a partir das peças do scorecard (janela de 90 dias de cada
 * conta, lib/scorecard.js) — a mesma base da linha "Consolidado" dos Resultados, para os
 * números de cima e os de baixo não discordarem.
 * - Cadência: publicações por semana na janela real (primeira → última peça).
 * - Consistência: % das semanas dessa janela com pelo menos uma publicação.
 */
function resumoPerfil(pecas) {
  if (!pecas.length) return null;
  const n = pecas.length;
  const views = pecas.reduce((s, v) => s + (Number(v.views) || 0), 0);
  const eng = pecas.reduce((s, v) => s + engDaPeca(v), 0);
  const com = pecas.reduce((s, v) => s + (Number(v.comments) || 0), 0);
  const dias = pecas.map((v) => Date.parse(String(v.posted_at).slice(0, 10))).filter(Number.isFinite).sort((a, b) => a - b);
  let cadencia = null, consistencia = null;
  if (dias.length) {
    const semanas = Math.max(1, Math.ceil((dias.at(-1) - dias[0] + 864e5) / (7 * 864e5)));
    cadencia = dias.length / semanas;
    const ativas = new Set(dias.map((d) => Math.floor((d - dias[0]) / (7 * 864e5))));
    consistencia = Math.round((ativas.size / semanas) * 100);
  }
  return {
    n, viewsMedia: Math.round(views / n), comentariosMedia: Math.round(com / n),
    taxaEng: engRateViews(eng, views), cadencia, consistencia,
  };
}
const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k" : String(Math.round(n));


export default async function CreatorPage(props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { id } = params;
  const client = CLIENTS.some((x) => x.id === searchParams?.cliente) ? searchParams.cliente : DEFAULT_CLIENT;
  const fromCamp = searchParams?.camp || null;
  const [{ user, role }, { c, bh, snaps, videos, cc, contas, vidsIrmas }] = await Promise.all([
    sessionRole(),
    fetchCreatorDetail(supabase, id),
  ]);

  if (!c) return <div className="wrap"><div className="empty">Creator não encontrado.</div></div>;

  const platformDe = Object.fromEntries(contas.map((x) => [x.id, x.platform]));
  const todosVideos = [...(videos || []), ...(vidsIrmas || [])].map((v) => ({ ...v, platform: platformDe[v.creator_id] ?? c.platform }));
  const porConta = {};
  for (const v of todosVideos) (porConta[v.creator_id] ||= []).push(v);

  const redes = contas.map((x) => ({ ...x, ativo: x.id === c.id, card: scorecardRede(porConta[x.id] || []) }));
  const combinado = contas.reduce((s, x) => s + (x.followers || 0), 0);

  // Saturação comercial na MESMA base da linha "Só publis" dos Resultados (feedback do
  // cliente, set/2026; ajuste de 11/09): todas as contas da pessoa, no recorte de 90 dias
  // de cada uma. Antes contava só a conta ativa e os dois números discordavam lado a lado.
  const comCard = redes.filter((r) => r.card);
  const satComercial = saturacaoPubli(comCard.flatMap((r) => r.card.pecas || []));
  // A janela é a união dos recortes, escrita em datas: "(90 dias)" por cima de peças de
  // julho é a mentira fácil desta página.
  const datas = comCard.flatMap((r) => [r.card.de, r.card.ate]).filter(Boolean).sort();
  const janelaTxt = datas.length ? `${diaCurto(datas[0], true)}–${diaCurto(datas.at(-1), true)}${comCard.length > 1 ? ` · ${comCard.length} redes` : ""}` : null;

  const resumo = resumoPerfil(comCard.flatMap((r) => r.card.pecas || []));
  // rede mais forte = a de mais views no recorte (a mesma leitura dos Resultados)
  const forte = comCard.length > 1 ? [...comCard].sort((a, b) => (b.card.views || 0) - (a.card.views || 0))[0] : null;
  const bigNumbers = [
    { label: "Seguidores", value: fmt(combinado), sub: contas.length > 1 ? `em ${contas.length} redes` : null, destaque: true },
    { label: "Views médias", value: resumo ? fmt(resumo.viewsMedia) : null, sub: janelaTxt },
    { label: "E.R.", value: pct(resumo?.taxaEng), title: "Taxa de engajamento: engajamentos ÷ views (lib/engagement.js)" },
    { label: "Comentários médios", value: resumo ? fmt(resumo.comentariosMedia) : null },
    { label: "Cadência", value: resumo?.cadencia != null ? `${resumo.cadencia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/sem.` : null, sub: "publicações por semana" },
    { label: "Consistência", value: resumo?.consistencia != null ? `${resumo.consistencia}%` : null, sub: "semanas com publicação" },
    forte && { label: "Rede mais forte", value: NOME_REDE[forte.platform] || forte.platform, sub: "mais views no período" },
  ];

  // Top conteúdos, Mood Board e nuvem: 90 dias, peças deduplicadas entre contas
  // (lib/creator-insights.js). Os "últimos 6" não têm janela — um creator parado há quatro
  // meses mostra na mesma as suas últimas peças. A transcrição não sai para o cliente.
  const insights = buildCreatorInsights(todosVideos);
  const semJanela = buildCreatorInsights(todosVideos, { dias: 36500 }).videos;
  const ultimos = semJanela.slice(0, 6);
  // reserva do Mood Board (F3.4): as últimas 24 peças, para quando não há nenhuma em 90 dias
  const recentes = insights.videos.length ? [] : semJanela.slice(0, 24);

  const check = disasterCheck({ bio: c.bio, videos: videos || [] });

  // Saturação de concorrentes calculada AGORA, e não lida do `kol_score` gravado.
  // As duas coisas ficam lado a lado no ecrã — a linha de saturação e os selos "rival"
  // do painel de marcas — e têm de sair da mesma passagem pela mesma régua
  // (lib/concorrentes.js). Com o valor gravado, uma marca ganha o selo de rival assim que
  // a régua melhora, mas a linha por cima continua a dizer "nenhuma" até alguém correr o
  // /api/kol-score outra vez. O score em si continua a ser o gravado: isto é a camada 3,
  // que por decisão do briefing (§8.4) nunca toca na nota.
  const concorrentes = saturacaoConcorrentes(bh?.brand_history, { hoje: new Date().toISOString().slice(0, 10) });

  const territorio = territorioDe({
    guardado: bh?.territorio ?? null,
    bucket: bh?.kol_screen?.metricas?.niche_bucket,
    analisado: (bh?.brand_history?.nichos ?? []).length > 0,
    textos: [(bh?.brand_history?.nichos ?? []).map((n) => n.nicho).join(" "), c.niche, c.category],
  });

  // A tag da ficha sai do kol_score gravado (lib/casting.js tagDaFicha) — sem nota à vista.
  const tag = tagDaFicha(bh);

  // Briefings são individuais (set/2026): o admin vê todos, os outros veem os seus, os que
  // lhes foram partilhados e os do regime legado (user_id null). Ver soMeus/veCampanha.
  const matches = (cc || [])
    .filter((m) => veCampanha(m.campaigns, user?.id, role === "admin"))
    .map((m) => ({ ...m, name: m.campaigns.name }));

  const perfilUrl = c.platform === "instagram" ? `https://www.instagram.com/${c.handle}/`
    : c.platform === "youtube" ? `https://www.youtube.com/@${c.handle}`
    : c.platform === "x" ? `https://x.com/${c.handle}`
    : `https://www.tiktok.com/@${c.handle}`;

  return (
    <div className="wrap">
      {fromCamp ? (
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <Link href={`/campanha/${fromCamp}?cliente=${client}`} className="back">← Voltar ao briefing</Link>
          <Link href="/creators-hub" className="back" style={{ opacity: 0.6 }}>Creators Hub</Link>
        </div>
      ) : (
        <Link href="/creators-hub" className="back">← Voltar</Link>
      )}

      {/* índice fixo: as antigas "abas" passaram a âncoras desta página única */}
      <nav className={rolo.atalhos} aria-label="Secções do perfil">
        {ATALHOS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="perfil" className={`profile fc-profile ${rolo.ancora}`}>
        <ScoreAvatar avatar={c.avatar_url} id={c.id} semNota size={140} nome={c.name || c.handle} />
        <div className="fc-profile-b">
          <h2>{c.name}</h2>
          <a className="handle" target="_blank" rel="noopener noreferrer" href={perfilUrl}>@{c.handle} · {c.platform} ↗</a>
          {/* big numbers antes de qualquer explicação (rodada 2): os seguidores saíram da
              linha de meta para aqui */}
          <BigNumbers items={bigNumbers} compacto className={rolo.bigNumbers} ariaLabel="Números do perfil" />
          <div className="fc-meta">
            {territorio && <span>{TERRITORIO_LABEL[territorio]}</span>}
            {c.janela_aberta && <span className="fc-meta-gold dica" data-dica={CONCEITO.janela} tabIndex={0}>◈ Janela aberta</span>}
            {tag && <span className={`fc-tag${tag === "pool" ? " fc-tag-pool" : ""}`}>{TAG_LABEL[tag]}</span>}
          </div>
          {contas.length > 1 && (
            <div className="fc-contas">
              {contas.map((x) => {
                const corpo = <><b>{fmt(x.followers)}</b><span><i>{x.platform}</i>@{x.handle}</span></>;
                return x.id === c.id
                  ? <span className="fc-conta on" key={x.id} title="Esta conta">{corpo}</span>
                  : <Link href={`/creator/${x.id}`} className="fc-conta" key={x.id} title={`Abrir a ficha de @${x.handle}`}>{corpo}</Link>;
              })}
            </div>
          )}
          {c.bio && <p className="bio">{c.bio}</p>}
        </div>
        <div className="fc-acoes">
          <AddToList creatorId={c.id} nome={c.name || c.handle} />
          <LigarConta handle={c.handle} />
          <EnrichButton handle={c.handle} creatorId={c.id} auto={searchParams?.novo === "1"} />
        </div>
      </section>

      <PerfilRolo ultimos={ultimos} recentes={recentes} insights={{ videos: insights.videos, topics: insights.topics, topicsFonte: insights.topicsFonte, coverage: insights.coverage }}
        hashtags={<Hashtags videos={todosVideos} />} />

      <section id="analise" className={`${rolo.secao} ${rolo.analise}`} aria-labelledby="analise-h">
      <h2 id="analise-h" className={rolo.analiseTitulo}>Análise completa</h2>
      <div className="fc-secs">
        <AutoridadeCreator kolScore={bh?.kol_score} tag={tag} history={bh?.brand_history} satComercial={satComercial} concorrentes={concorrentes}
          saturacao={{ janela: janelaTxt }} territorioLabel={territorio ? TERRITORIO_LABEL[territorio] : null} />

        <ScorecardRedes redes={redes} />
        <ConversaComunidade conversa={bh?.conversa} />

        <div className="two-col" style={{ marginTop: 0 }}>
          <TopicosConteudo history={bh?.brand_history} />
          <MarcasColaborou history={bh?.brand_history} ajustar={temTopicos(bh?.brand_history)} handle={c.handle} />
        </div>

        <DisasterCheck check={check} />
        <AnaliseDiarizada snaps={snaps || []} />
        <ConteudosGrid videos={contentVideosForClient(todosVideos)} />
        {/* Principais hashtags subiu para o lado da nuvem de palavras (#palavras) */}
        <BriefingMatch matches={matches} />
      </div>
      </section>

      <footer className="footer">
        <span>KOLLECT by Snack</span>
        <span>No radar desde {new Date(c.discovered_at).toLocaleDateString("pt-BR")}</span>
      </footer>
    </div>
  );
}
