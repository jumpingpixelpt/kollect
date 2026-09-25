import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer as supabase } from "@/lib/supabase";
import { sessionRole } from "@/lib/auth-server";
import BriefingCreate from "@/components/BriefingCreate";
import BriefingFilter from "@/components/BriefingFilter";
import BriefAvatar from "@/components/BriefAvatar";
import { avatarSrc } from "@/lib/avatar-src";
import PromoteButton from "@/components/PromoteButton";
import { fetchPageRows, fetchPageCounts } from "@/lib/page-data";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;
const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
// mesmo proxy de imagem do RadarListing: CDNs das plataformas expiram/bloqueiam hotlink

/**
 * Briefings — o pedido do cliente como objeto de primeira classe (brief-first).
 * O briefing nasce com nome + caracterização; os membros são candidatos que
 * respondem ao pedido, anexados a partir das Descobertas. A área é deliberadamente
 * só de leitura: as ações sobre pessoas vivem nas Descobertas e nas Listas.
 *
 * O detalhe lê da view briefing_member_view (membro + creator ligado ao vivo por
 * tubular_id/handle+plataforma): um briefing pode ter dezenas de milhares de
 * candidatos, e classificar por aba, contar e paginar tem de acontecer no
 * Postgres — carregar os membros para o Node esbarrava no tecto de 1000 linhas
 * do PostgREST.
 */
export default async function Briefings(props) {
  const searchParams = await props.searchParams;
  const id = searchParams?.id || null;
  // Área de Gestão: só admins (decisão do cliente, ago/2026). O menu já a esconde ao
  // operador, mas o gate tem de estar aqui — esconder o link não fecha o URL. Mesmo
  // padrão do /admin: quem não tem papel volta ao radar em vez de ver um erro.
  const { role } = await sessionRole();
  const isAdmin = role === "admin";
  if (!isAdmin) redirect("/");

  // ── detalhe de um briefing ──
  if (id) {
    const tab = searchParams?.tab === "radar" ? "radar" : "descobertas";
    const page = Math.max(1, Number(searchParams?.page) || 1);
    // filtro por termo dentro do briefing — mesma mecânica das Descobertas
    // (?termo= repetido, o Next entrega array quando o param se repete)
    const termoParam = searchParams?.termo;
    const termosSel = (Array.isArray(termoParam) ? termoParam : termoParam ? [termoParam] : [])
      .map((t) => t.trim()).filter(Boolean);
    const comTermo = (q) => termosSel.length ? q.in("termo_efetivo", termosSel) : q;
    // Irrecuperáveis fora da vista, como nas Descobertas: sem @ não há promoção possível, e
    // ordenam por score alto — ficavam à cabeça da aba a esconder quem é acionável. Aplica-se
    // à consulta E às contagens das abas, senão o número prometia candidatos que não aparecem.
    // Ver docs/handles-irrecuperaveis.md: saem os que têm veredicto, não os que falharam uma vez.
    // p_oculto (view) e não `not like` sobre p_status: membro já promovido pode não ter linha
    // de prospect, e NULL LIKE '…' é NULL — o `not like` comia esses também (o radar caiu
    // 655→358 na primeira versão). A coluna vem com COALESCE para false, nunca é nula.
    const semMortos = (q) => q.eq("p_oculto", false);
    const visivel = (q) => semMortos(comTermo(q));

    let pageQuery = visivel(supabase.from("briefing_member_view")
      .select("id, prospect_id, cid, p_name, p_handle, p_platform, p_followers, p_mini, p_termo, termo, avatar")
      .eq("briefing_id", id));
    pageQuery = tab === "radar" ? pageQuery.not("cid", "is", null) : pageQuery.is("cid", null);
    // Página e contagens são independentes: começar tudo junto evita uma etapa
    // inteira de espera. score_ord mantém a régua do cartão e id desempata a página.
    const [{ data: briefing }, { count: nDesc }, { count: nRadar }, termoRows, { data: rows }] = await Promise.all([
      supabase.from("briefings").select("id, name, caracterizacao").eq("id", id).single(),
      visivel(supabase.from("briefing_member_view").select("id", { count: "exact", head: true }).eq("briefing_id", id).is("cid", null)),
      visivel(supabase.from("briefing_member_view").select("id", { count: "exact", head: true }).eq("briefing_id", id).not("cid", "is", null)),
      fetchPageRows(() => supabase.from("briefing_termos").select("termo, n").eq("briefing_id", id)
        .order("n", { ascending: false }).order("termo")),
      pageQuery.order("score_ord", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    ]);

    // dados do radar só para os cids DESTA página (≤ 200)
    const cids = [...new Set((rows ?? []).map((r) => r.cid).filter(Boolean))];
    const { data: creators } = cids.length
      ? await supabase.from("leaderboard").select("id, name, handle, platform, followers, total, kol_nota").in("id", cids)
      : { data: [] };
    const cBy = {}; for (const c of creators ?? []) cBy[c.id] = c;

    const n = (nDesc ?? 0) + (nRadar ?? 0);
    const totalTab = tab === "radar" ? (nRadar ?? 0) : (nDesc ?? 0);
    const lastPage = Math.max(1, Math.ceil(totalTab / PAGE_SIZE));
    const qs = (p, t = tab) => {
      const u = new URLSearchParams({ id });
      if (t === "radar") u.set("tab", "radar");
      for (const tm of termosSel) u.append("termo", tm);
      if (p > 1) u.set("page", String(p));
      return `/briefings?${u.toString()}`;
    };

    return (
      <div className="wrap">
        <Link href="/briefings" className="back">← Todas as análises</Link>
        <section className="hero" style={{ padding: "30px 0 18px" }}>
          <h1 style={{ fontSize: "clamp(26px, 4vw, 38px)" }}>{briefing?.name || "Briefing"}</h1>
          {/* números exatos, não "10k": promover 29 tem de se VER a mexer no contador */}
          <p>{n.toLocaleString("pt-BR")} candidato{n === 1 ? "" : "s"} respondendo a este pedido — {(nDesc ?? 0).toLocaleString("pt-BR")} na descoberta, {(nRadar ?? 0).toLocaleString("pt-BR")} no radar.</p>
        </section>
        {briefing?.caracterizacao && (
          <section className="proj">
            <div className="proj-head"><h3>Caracterização <span>· o pedido do cliente</span></h3></div>
            <div className="proj-note" style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55 }}>{briefing.caracterizacao}</div>
          </section>
        )}
        <div className="net-tabs">
          <Link href={qs(1, "descobertas")} className={`net-tab${tab === "descobertas" ? " active" : ""}`} style={{ textDecoration: "none" }}>
            <span className="net-name">◎ Descobertas</span>
            <span className="net-meta">{(nDesc ?? 0).toLocaleString("pt-BR")} por promover</span>
          </Link>
          <Link href={qs(1, "radar")} className={`net-tab${tab === "radar" ? " active" : ""}`} style={{ textDecoration: "none" }}>
            <span className="net-name">✦ Radar</span>
            <span className="net-meta">{(nRadar ?? 0).toLocaleString("pt-BR")} no radar</span>
          </Link>
        </div>
        {isAdmin && (termoRows ?? []).length > 0 && (
          <BriefingFilter briefingId={id} tab={tab} termosSel={termosSel} termos={termoRows ?? []} />
        )}
        <div className="dlist">
          {(rows ?? []).map((m, i) => {
            const c = m.cid ? cBy[m.cid] : null;
            const name = c?.name || m.p_name || "—";
            // A régua do briefing é a do pedido do cliente (§8, Score KOL) — a mesma do anel
            // da ficha, para o clique no dossiê não mudar de número (47 radar → 92 KOL no
            // @bonnicachos foi lido como bug). A view leaderboard só expõe kol_nota a quem é
            // elegível, portanto o encadeamento já cumpre a regra do nota(): quem não tem
            // screening cai no radar, quem nem promovido está cai no mini-score.
            const score = c?.kol_nota ?? c?.total ?? m.p_mini ?? null;
            const scoreTipo = c?.kol_nota != null ? "score KOL" : c?.total != null ? "radar" : m.p_mini != null ? "mini-score" : "sem nota";
            // congelado ao anexar; fallback ao termo vivo do prospect para membros
            // anexados antes da coluna existir
            const termo = m.termo ?? m.p_termo ?? null;
            const handle = c?.handle || m.p_handle;
            return (
              <div className="drow" key={m.id}>
                {/* posição na ordem por score, como nas Descobertas — substitui a bola vazia */}
                <span className="rank" style={{ position: "static" }}>№ {(page - 1) * PAGE_SIZE + i + 1}</span>
                {/* Foto só na aba Radar (decisão do cliente, 03/ago/2026). Lá vem do creator e
                    existe para 100% das linhas; na Descoberta vem do `thumbnail` que a Tubular
                    dá na colheita e só cobre 77% — a lista alternava linha com foto e linha sem,
                    e essa alternância lia-se como defeito. Uniforme sem foto > irregular com.
                    Foto durável por creator (lib/avatar-src.js); morta → inicial (B4, set/2026). */}
                {tab === "radar" && m.avatar
                  ? <BriefAvatar src={avatarSrc(m.avatar, m.cid)} nome={name} />
                  : null}
                <div className="dinfo">
                  <div className="dname">{m.cid ? <Link href={`/creator/${m.cid}`} style={{ color: "inherit" }}>{name} <span style={{ opacity: .6, fontSize: 12 }}>→ dossiê</span></Link> : name}</div>
                  <div className="dmeta">
                    {fmt(c?.followers ?? m.p_followers)} seguidores · {(c?.platform || m.p_platform || "—")}{handle ? ` · @${handle}` : ""}
                    {isAdmin && termo ? <span className="dwhen" title="Termo de busca que trouxe esta descoberta">{termo}</span> : null}
                  </div>
                </div>
                <div className="dscore">
                  <div className="v">{score != null ? Number(score).toFixed(0) : "—"}</div>
                  <div className="k">{scoreTipo}</div>
                </div>
                {!m.cid && m.prospect_id && <PromoteButton tubularId={m.prospect_id} />}
              </div>
            );
          })}
          {!n && <div className="dmeta" style={{ padding: 24 }}>Ainda sem candidatos. Vá em <Link href="/descobertas" style={{ color: "var(--gold-bright)" }}>Descobertas</Link>, selecione creators e use “+ Análise”.</div>}
          {n > 0 && !(rows ?? []).length && page === 1 && (
            <div className="dmeta" style={{ padding: 24 }}>
              {termosSel.length
                ? "Nenhum candidato desta aba com os termos selecionados — limpe o filtro para ver todos."
                : tab === "radar"
                  ? "Nenhum candidato deste briefing chegou ao radar ainda — promova-os a partir das Descobertas."
                  : "Nenhum candidato na fila da descoberta — todos já foram promovidos ao radar. ✓"}
            </div>
          )}
        </div>
        {lastPage > 1 && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "26px 0" }}>
            {page > 1 && <Link className="chip" href={qs(page - 1)}>← Anterior</Link>}
            <span className="chip" style={{ opacity: 0.7 }}>página {page} de {lastPage}</span>
            {page < lastPage && <Link className="chip" href={qs(page + 1)}>Próxima →</Link>}
          </div>
        )}
        <footer className="footer"><span>KOLLECT by Snack</span><span>Análise de dados · Confidencial</span></footer>
      </div>
    );
  }

  // ── todos os briefings ──
  const briefings = await fetchPageRows(() => supabase.from("briefings").select("id, name, caracterizacao, created_at")
    .order("created_at", { ascending: false }).order("id"));
  // Uma agregação para todos os cartões. Exclui irrecuperáveis com a mesma regra
  // p_oculto da view, sem refazer seus joins de creators/scores para cada briefing.
  const { briefings: countRows } = await fetchPageCounts(supabase, { briefingIds: briefings.map((b) => b.id) });
  const counts = Object.fromEntries(countRows.map((r) => [r.id, r.total]));

  return (
    <div className="wrap">
      <section className="hero" style={{ padding: "44px 0 20px" }}>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Análise <em>de dados</em></h1>
        <p>O pedido primeiro, os nomes depois: cada análise nasce da caracterização do que o cliente procura, e os candidatos são anexados em <Link href="/descobertas" style={{ color: "var(--gold-bright)" }}>Descobertas</Link> como resposta a esse pedido.</p>
      </section>
      <div style={{ margin: "0 0 18px" }}><BriefingCreate /></div>
      <div className="dlist">
        {(briefings ?? []).map((b) => {
          const total = counts[b.id] ?? 0;
          return (
            <Link href={`/briefings?id=${b.id}`} className="drow" key={b.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="davatar davatar-empty">✎</div>
              <div className="dinfo">
                <div className="dname">{b.name}</div>
                <div className="dmeta">
                  {fmt(total)} candidato{total === 1 ? "" : "s"} · criado em {new Date(b.created_at).toLocaleDateString("pt-BR")}
                  {b.caracterizacao ? <span style={{ display: "block", marginTop: 4, color: "var(--text-dim)", fontStyle: "italic" }}>{b.caracterizacao.length > 160 ? b.caracterizacao.slice(0, 160) + "…" : b.caracterizacao}</span> : null}
                </div>
              </div>
              <div className="dscore"><div className="v">{fmt(total)}</div><div className="k">candidatos</div></div>
            </Link>
          );
        })}
        {!(briefings ?? []).length && <div className="dmeta" style={{ padding: 24 }}>Nenhuma análise ainda. Crie a primeira com “✎ Nova análise” — descreva o pedido do cliente e depois anexe candidatos nas Descobertas.</div>}
      </div>
      <footer className="footer"><span>KOLLECT by Snack</span><span>Análise de dados · Confidencial</span></footer>
    </div>
  );
}
