import Link from "next/link";
import { diaCurto } from "@/lib/datas";
import { isPubli } from "@/lib/publi";
import { engRateViews } from "@/lib/engagement";

/**
 * RESULTADOS DA CREATOR — primeiro o consolidado de todas as redes, depois cada rede, e por
 * fim só as publis (feedback do cliente, set/2026, pontos 15 e 17).
 *
 * As contas-irmãs vêm de `person_key`. A janela real de cada conta vai escrita na linha:
 * "últimos 30 dias" sobre peças de julho é a mentira fácil desta página — quando a conta
 * não tem peças que cheguem na janela, o scorecard cai nas últimas peças e diz que caiu
 * (lib/scorecard.js).
 *
 * No lugar dos blocos "O que é / Por que acompanhar" entram leituras automáticas dos
 * números: em que rede a creator tem mais força, e se as publis engajam menos que o
 * orgânico. Taxa de engajamento é sempre engajamentos ÷ views (lib/engagement.js).
 */

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const NOME_REDE = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
const rede = (p) => NOME_REDE[p] || p;

const COLS = [
  ["views", "Views", (c) => fmt(c.views)],
  ["eng", "Engajamento", (c) => fmt(c.eng)],
  ["posts", "Volumetria", (c) => String(c.posts)],
  ["viewsMedia", "Views média", (c) => fmt(c.viewsMedia)],
  ["engMedia", "Engajamento médio", (c) => fmt(c.engMedia)],
  ["comentariosMedia", "Comentários média", (c) => fmt(c.comentariosMedia)],
  ["taxaEng", "Taxa de engajamento", (c) => c.taxaEng == null ? "—" : `${c.taxaEng}%`],
];

const soma = (arr, f) => arr.reduce((s, v) => s + (Number(f(v)) || 0), 0);
const eng = (v) => (v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0);

/** Um card no formato de lib/scorecard.js a partir de um conjunto de peças. */
function cardDe(pecas) {
  const n = pecas.length;
  if (!n) return null;
  const views = soma(pecas, (v) => v.views), e = soma(pecas, eng), com = soma(pecas, (v) => v.comments);
  return { posts: n, views, eng: e, viewsMedia: Math.round(views / n), engMedia: Math.round(e / n), comentariosMedia: Math.round(com / n), taxaEng: engRateViews(e, views) };
}

export default function ScorecardRedes({ redes }) {
  const comDados = (redes || []).filter((r) => r.card);
  const todas = comDados.flatMap((r) => r.card.pecas || []);
  const total = cardDe(todas);
  const publis = cardDe(todas.filter(isPubli));
  const organicas = cardDe(todas.filter((v) => !isPubli(v)));

  // leituras automáticas: rede com mais força, e publi vs orgânico
  const leituras = [];
  if (comDados.length > 1 && total) {
    const porViews = [...comDados].sort((a, b) => (b.card.views || 0) - (a.card.views || 0));
    const forte = porViews[0];
    const maiorAud = [...comDados].sort((a, b) => (b.followers || 0) - (a.followers || 0))[0];
    const maisCom = [...comDados].sort((a, b) => (b.card.comentariosMedia || 0) - (a.card.comentariosMedia || 0))[0];
    if (maiorAud.id !== forte.id) {
      leituras.push(`Embora tenha uma audiência maior no ${rede(maiorAud.platform)} (${fmt(maiorAud.followers)} seguidores), a creator apresenta mais força de views e engajamento no ${rede(forte.platform)}${maisCom.id === forte.id ? ", onde também gera mais conversa por peça" : ""}.`);
    } else {
      leituras.push(`${rede(forte.platform)} é atualmente a principal rede da creator, concentrando o maior volume de visualizações${maisCom.id === forte.id ? " e uma média de comentários acima das demais plataformas" : `; a média de comentários é maior no ${rede(maisCom.platform)}`}.`);
    }
  }
  // só com base: uma publi em 27 peças não diz nada, e contradizia a nota do brand-scan ao lado
  if (publis && organicas && publis.posts >= 3 && organicas.posts >= 3 && publis.taxaEng != null && organicas.taxaEng != null && organicas.taxaEng > 0) {
    const dif = Math.round(((publis.taxaEng - organicas.taxaEng) / organicas.taxaEng) * 100);
    leituras.push(
      dif <= -20 ? `As publis engajam ${Math.abs(dif)}% menos que o conteúdo orgânico (${publis.posts} publi${publis.posts > 1 ? "s" : ""} em ${total.posts} peças) — conteúdo de marca dilui a audiência; o briefing precisa de ser mais nativo.`
      : dif >= 20 ? `As publis engajam ${dif}% mais que o conteúdo orgânico (${publis.posts} publi${publis.posts > 1 ? "s" : ""} em ${total.posts} peças) — a audiência aceita bem conteúdo de marca.`
      : `As publis engajam ao nível do conteúdo orgânico (${publis.posts} publi${publis.posts > 1 ? "s" : ""} em ${total.posts} peças).`
    );
  }

  const Linha = ({ id, esq, titulo, sub, card, cls = "" }) => (
    <div className={`fc-rede ${cls}`} key={id}>
      <div className="fc-rede-id">{esq}</div>
      <div className="fc-rede-h"><b>{titulo}</b><i>{sub}</i></div>
      {COLS.map(([k, label, val]) => (
        <div className="fc-rede-c" key={k}>
          <b>{val(card)}</b>
          <i>{label}</i>
        </div>
      ))}
    </div>
  );

  return (
    <div className="panel">
      <h3>Resultados da creator</h3>

      {!comDados.length && (
        <div className="fc-vazio">Nenhuma peça com data importada — sem peças não há resultados. Corre ↻ Atualizar dados.</div>
      )}

      {leituras.map((t, i) => <p className="fc-leitura" key={i}>{t}</p>)}

      {total && (
        <>
          <div className="fc-rede-sec">Resultados gerais</div>
          <Linha id="total" cls="fc-rede-total"
            esq={<><b>{fmt(comDados.reduce((s, r) => s + (r.followers || 0), 0))}</b><i>{comDados.length > 1 ? `${comDados.length} redes` : rede(comDados[0].platform)}</i></>}
            titulo="Todas as redes" sub={`${total.posts} peças no recorte de cada conta`} card={total} />
        </>
      )}

      {comDados.length > 0 && <div className="fc-rede-sec">Resultados por rede social</div>}
      {comDados.map((r) => (
        <Linha key={r.id} id={r.id}
          esq={r.ativo
            ? <><b>{fmt(r.followers)}</b><i>{rede(r.platform)}</i></>
            : <Link href={`/creator/${r.id}`}><b>{fmt(r.followers)}</b><i>{rede(r.platform)}</i></Link>}
          titulo={`@${r.handle}`}
          sub={r.card.fallback
            ? `sem peças nos últimos ${r.card.dias} dias · últimas ${r.card.posts} (${diaCurto(r.card.de, true)}–${diaCurto(r.card.ate, true)})`
            : `${diaCurto(r.card.de)}–${diaCurto(r.card.ate)}`}
          card={r.card} />
      ))}

      {publis && (
        <>
          <div className="fc-rede-sec">Só publis</div>
          <Linha id="publi" cls="fc-rede-publi"
            esq={<><b>{publis.posts}</b><i>publi{publis.posts > 1 ? "s" : ""}</i></>}
            titulo="Conteúdo patrocinado" sub={`peças com publicidade declarada, todas as redes${organicas ? ` · orgânico: ${organicas.posts} peça${organicas.posts > 1 ? "s" : ""}, ${organicas.taxaEng ?? "—"}% de engajamento` : ""}`}
            card={publis} />
        </>
      )}
    </div>
  );
}
