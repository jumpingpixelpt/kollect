import Link from "next/link";
import { supabaseServer as supabase } from "@/lib/supabase";
import { fetchPageRows, fetchPageIds, fetchCampaignCreatorClasses } from "@/lib/page-data";
import { sessionRole, soMeus, mandaNaCampanha } from "@/lib/auth-server";
import { ksRamoDe, contaNoCasting, tagDe } from "@/lib/casting";
import CampaignDelete from "@/components/CampaignDelete";
import HistoricoSearch from "@/components/HistoricoSearch";
import BigNumbers from "@/components/BigNumbers";
import styles from "./historico.module.css";
import { filtrosHistorico, filtrarHistorico } from "@/lib/historico-filtros";
import { buscasPendentes } from "@/lib/buscas";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); }
  catch { return String(d).slice(0, 10); }
};

export default async function Campanhas(props) {
  const searchParams = await props.searchParams;
  const filtros = filtrosHistorico(searchParams);
  const { q, ord, de, ate, erro } = filtros;
  const { user, role } = await sessionRole();
  // Buscas do próprio utilizador que não chegaram a briefing (feedback rodada 2, bug 2):
  // uma leitura falhada ou por confirmar também é histórico — "fiz a busca e desapareceu".
  const pendentesP = buscasPendentes(user?.id);
  const camps = await fetchPageRows(() => soMeus(supabase.from("campaigns")
    .select("id, name, created_at, status, publico_alvo:parsed->>publico_alvo, user_id, shared_with"), user?.id, role === "admin")
    .order("created_at", { ascending: false }).order("id"));
  // Filtrar acesso, nome e período ANTES de ler castings. A pesquisa mantém a normalização
  // sem acentos; um recorte vazio não consulta membros nem creators.
  const relevantes = filtrarHistorico(camps, filtros);
  const rows = await fetchPageIds((ids) => supabase.from("campaign_creators")
    .select("campaign_id, creator_id, kind, campaign_role, status")
    .in("campaign_id", ids).order("id"), relevantes.map((c) => c.id));

  // As MESMAS regras da ficha (lib/casting.js): "no casting" = casting visível (creators no
  // radar, sem não-recomendadas). Sem score no cartão (feedback do cliente, set/2026): o
  // que se conta é quantos KOLs a lista tem e quantos nomes estão em estudo.
  const creatorIds = [...new Set((rows ?? []).filter((r) => r.creator_id).map((r) => r.creator_id))];
  const creators = await fetchCampaignCreatorClasses(supabase, creatorIds);
  const cBy = Object.fromEntries(creators.map((c) => [c.id, c]));
  const ramoBy = {};
  for (const c of relevantes) ramoBy[c.id] = ksRamoDe({ publico_alvo: c.publico_alvo });

  // Etiqueta de partilha (set/2026): quem recebe vê "partilhado consigo"; o dono vê com
  // quantos partilhou; o admin, que vê tudo, distingue o que não é seu. Legado fica sem etiqueta.
  const etiqueta = (c) => {
    if (c.user_id == null) return null;
    if (c.user_id !== user?.id) return (c.shared_with ?? []).includes(user?.id) ? "partilhado consigo" : "de outro utilizador";
    return c.shared_with?.length ? `partilhado com ${c.shared_with.length}` : null;
  };

  const agg = {};
  for (const r of rows ?? []) {
    const a = (agg[r.campaign_id] ||= { total: 0, kols: 0, estudo: 0 });
    const c = r.creator_id ? cBy[r.creator_id] : null;
    if (c && contaNoCasting(r, c, ramoBy[r.campaign_id])) {
      a.total++;
      if (tagDe(r, c, ramoBy[r.campaign_id]) === "kol") a.kols++;
    }
    if (r.status === "em_estudo") a.estudo++;
  }

  // Ordenação depois das contagens: "maior casting" usa as mesmas regras de
  // elegibilidade e disaster do detalhe, sem criar uma segunda régua em SQL.
  const listados = relevantes
    .sort((a, b) => {
      if (ord === "antigos") return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      if (ord === "nome") return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
      if (ord === "casting") return (agg[b.id]?.total ?? 0) - (agg[a.id]?.total ?? 0);
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

  // Big numbers antes da explicação (feedback rodada 2, L5): totais do recorte filtrado.
  const totais = listados.reduce((t, c) => {
    const a = agg[c.id];
    if (a) { t.total += a.total; t.kols += a.kols; t.estudo += a.estudo; }
    return t;
  }, { total: 0, kols: 0, estudo: 0 });
  const n = (v) => v.toLocaleString("pt-BR");
  const pendentes = await pendentesP;

  return (
    <div className="wrap">
      <section className="hero" style={{ padding: "30px 0 14px" }}>
        <h1 style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Histórico</h1>
      </section>

      {!erro && listados.length > 0 && (
        <BigNumbers compacto className={styles.numeros} ariaLabel="Totais do histórico" items={[
          { label: listados.length === 1 ? "Briefing" : "Briefings", value: n(listados.length) },
          { label: "No casting", value: n(totais.total), title: "Soma dos castings visíveis dos briefings listados; o mesmo creator pode contar em mais de um." },
          { label: "KOLs", value: n(totais.kols), destaque: true },
          { label: "Em estudo", value: n(totais.estudo) },
        ]} />
      )}
      <p className={styles.intro}>
        Cada briefing submetido fica guardado aqui — com o casting gerado, a justificativa
        de cada creator e o status de curadoria. Crie um novo colando um briefing na <Link href="/">Busca</Link>.
      </p>

      <HistoricoSearch q={q} ord={ord} de={de} ate={ate} />

      {erro ? (
        <div className="empty" role="alert">{erro}</div>
      ) : !camps?.length ? (
        <div className="empty">Nenhum briefing ainda. Cole um briefing na Busca pra gerar o primeiro casting.</div>
      ) : !listados.length ? (
        <div className="empty">Nenhum briefing encontrado com os filtros selecionados. Ajuste o nome ou o período para buscar novamente.</div>
      ) : (
        // Lista em linhas (feedback rodada 2, F2.6): um briefing por linha, números compactos,
        // seta de abrir no fim e o apagar à direita. Em ecrã estreito a linha empilha.
        <ul className={styles.lista} aria-label="Briefings">
          {listados.map((c) => {
            const a = agg[c.id] || { total: 0, kols: 0, estudo: 0 };
            const partilha = etiqueta(c);
            return (
              <li key={c.id} className={styles.linha}>
                <div className={styles.info}>
                  <Link href={`/campanha/${c.id}`} className={styles.nome}>{c.name || "Briefing"}</Link>
                  <div className={styles.meta}>
                    <span>{fmtDate(c.created_at)}</span>
                    <span className={styles.estado}>{c.status || "ativa"}</span>
                    {partilha && <span className={styles.partilha}>· {partilha}</span>}
                  </div>
                </div>
                <dl className={styles.contagens}>
                  <div className={styles.contagem}><dt>no casting</dt><dd>{a.total}</dd></div>
                  <div className={`${styles.contagem} ${styles.kols}`}><dt>KOLs</dt><dd>{a.kols}</dd></div>
                  <div className={styles.contagem}><dt>em estudo</dt><dd>{a.estudo}</dd></div>
                </dl>
                <Link href={`/campanha/${c.id}`} className={`seta-linha ${styles.seta}`} aria-label={`Abrir casting de ${c.name || "Briefing"}`} title="Abrir casting">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                </Link>
                <div className={styles.apagar}>
                  {mandaNaCampanha(c, user?.id, role === "admin") && <CampaignDelete campaignId={c.id} name={c.name} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pendentes.length > 0 && (
        <>
          <h2 className={styles.pendentesTitulo}>Buscas não concluídas</h2>
          <ul className={`${styles.lista} ${styles.pendentes}`} aria-label="Buscas não concluídas">
            {pendentes.map((p) => (
              <li key={p.id} className={styles.linha}>
                <div className={styles.info}>
                  <span className={styles.nome}>{p.titulo}</span>
                  <div className={styles.meta}>
                    <span>{fmtDate(p.quando)}</span>
                    <span className={styles.naoConcluida}>Não concluída</span>
                    <span>{p.estado === "erro" ? "a leitura não terminou" : "falta confirmar"}</span>
                  </div>
                </div>
                <Link href={`/?retomar=${p.id}`} className={styles.retomar}>Retomar →</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <footer className="footer" style={{ marginTop: 36 }}>
        <span>KOLLECT by Snack</span>
        <span>Briefings · Confidencial</span>
      </footer>
    </div>
  );
}
