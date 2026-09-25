import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer as supabase } from "@/lib/supabase";
import { sessionRole, soMeus } from "@/lib/auth-server";
import { fold } from "@/lib/text";
import ProspectSearch from "@/components/ProspectSearch";
import DiscoverySelection from "@/components/DiscoverySelection";
import DiscoveryRunner from "@/components/DiscoveryRunner";
import DiscoveryPerfilRunner from "@/components/DiscoveryPerfilRunner";
import PromoteRunner from "@/components/PromoteRunner";
import FunilStats from "@/components/FunilStats";
import { painelResumo } from "@/lib/painel-resumo";
import { fetchPageRows, fetchPageIds } from "@/lib/page-data";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;
const PROSPECT_FIELDS = "tubular_id,name,handle,platform,followers,growth_30,eng_rate,mini_score,rising_star,thumbnail,status,descoberto_em,fonte,genre,termo,post_url,views_total,uploads_90,last_upload";

export default async function Descobertas(props) {
  const searchParams = await props.searchParams;
  const campaignId = searchParams?.c || null;
  const q = (searchParams?.q || "").trim();
  const min = Number(searchParams?.min) || 0;
  const max = Number(searchParams?.max) || 0;
  // janela de descoberta em dias: 1 = hoje. Sem isto não havia forma de ver o que uma
  // corrida acabou de trazer — as descobertas entram ordenadas por mérito no meio de 40 mil
  // linhas e, sem data no cartão, ficam indistinguíveis das de junho.
  const desde = Number(searchParams?.desde) || 0;
  // ordenação: mérito (mini-score) por omissão, ou data de importação (afinação do cliente)
  const ord = searchParams?.ord === "data" ? "data" : "score";
  // termos de busca que trouxeram a descoberta ("dia a dia", "minoxidil", …) — o último
  // item do badge de procedência. Filtro pedido pelo operador (ago/2026) para triar uma
  // colheita termo a termo; seleção múltipla (?termo= repetido — o Next entrega array
  // quando o param se repete); como o resto da procedência, só aparece para admins.
  const termoParam = searchParams?.termo;
  const termosSel = (Array.isArray(termoParam) ? termoParam : termoParam ? [termoParam] : [])
    .map((t) => t.trim()).filter(Boolean);
  const page = Math.max(1, Number(searchParams?.page) || 1);
  // a procedência (tubular, excel, …) é detalhe de operação — só os admins a veem;
  // o utilizador normal fica com a data de importação (afinação do cliente, jul/2026)
  const { user, role } = await sessionRole();
  const isAdmin = role === "admin";
  // gate na página, não no middleware (que só garante sessão): o funil de captação é
  // operação da casa. Operador que chegue aqui por URL volta ao início.
  if (!isAdmin) redirect("/");
  // UTC de propósito: é o fuso em que as rotas de descoberta gravam `descoberto_em`, e
  // comparar noutro marcaria as descobertas como velhas antes do tempo.
  const diaISO = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  const hojeISO = diaISO(0);

  // listas, campanhas, tags e briefings disponiveis pras acoes de selecao (validos nos dois modos)
  // Disparar junto dos dados da página, sem esperar pelos quatro menus primeiro.
  const selectionPromise = Promise.all([
    fetchPageRows(() => supabase.from("lists").select("id, name").order("created_at", { ascending: false }).order("id")),
    fetchPageRows(() => soMeus(supabase.from("campaigns").select("id, name"), user?.id, isAdmin).order("created_at", { ascending: false }).order("id")),
    fetchPageRows(() => supabase.from("tags").select("id, name").order("name").order("id")),
    fetchPageRows(() => supabase.from("briefings").select("id, name").order("created_at", { ascending: false }).order("id")),
  ]).then(([lists, campaigns, tags, briefings]) => ({ lists, campaigns, tags, briefings }));

  // ── helper: que prospects já viraram creators no radar ──
  // Recebe as LINHAS e liga por tubular_id E por handle+plataforma. Duas lições do caso
  // Pâmela Nogueira (jul/2026): (1) só se verificava quem tinha status "promovido", mas um
  // trail falhado a meio deixa o status em erro com o creator já criado — e o card seguia
  // oferecendo "Promover" para quem já estava no radar; (2) promoções via "Avaliar perfil"
  // criam o creator sem o tubular_id do prospect, e só o handle liga os dois.
  const linkPromoted = async (rows) => {
    if (!rows.length) return {};
    const ids = rows.map((r) => r.tubular_id).filter(Boolean);
    const handles = [...new Set(rows.map((r) => (r.handle || "").toLowerCase()).filter(Boolean))];
    const [porId, porHandle] = await Promise.all([
      fetchPageIds((part) => supabase.from("creators").select("id, tubular_id").in("tubular_id", part).order("id"), ids),
      fetchPageIds((part) => supabase.from("creators").select("id, handle, platform").in("handle", part).order("id"), handles),
    ]);
    const hPlat = {}, hAny = {};
    for (const c of porHandle) {
      const h = (c.handle || "").toLowerCase();
      hPlat[`${c.platform}:${h}`] = c.id;
      hAny[h] = c.id;
    }
    const by = {};
    for (const r of rows) {
      const h = (r.handle || "").toLowerCase();
      if (!h) continue;
      // O @ casa mesmo com plataforma diferente (03/ago/2026). `creators` tem UNIQUE (handle)
      // e a RPC ingest_profile faz `on conflict (handle)`: um @ só existe UMA vez no radar,
      // seja em que plataforma for. Enquanto isso for verdade, exigir plataforma igual
      // prometia uma promoção que a base não consegue cumprir — @michellewellica estava no
      // radar como TikTok e o cartão do Instagram continuava a oferecer "Promover ao radar",
      // que corria, não criava nada, e deixava o contador na mesma.
      const cid = hPlat[`${r.platform}:${h}`] ?? hAny[h] ?? null;
      if (cid) by[r.tubular_id] = cid;
    }
    for (const c of porId) if (c.tubular_id) by[c.tubular_id] = c.id;
    return by;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MODO A — pré-score de um briefing (campanha): mostra o casting como descoberta
  // ─────────────────────────────────────────────────────────────────────────
  if (campaignId) {
    const [{ data: campaign }, rows, selProps] = await Promise.all([
      supabase.from("campaigns").select("id, name").eq("id", campaignId).single(),
      fetchPageRows(() => supabase.from("campaign_creators").select("id,creator_id,prospect_id,match_score,rationale")
        .eq("campaign_id", campaignId).order("match_score", { ascending: false }).order("id")),
      selectionPromise,
    ]);
    const creatorIds = (rows ?? []).filter((r) => r.creator_id).map((r) => r.creator_id);
    const prospectIds = (rows ?? []).filter((r) => !r.creator_id && r.prospect_id).map((r) => r.prospect_id);
    const [creators, prospects] = await Promise.all([
      fetchPageIds((part) => supabase.from("leaderboard").select("id, name, handle, platform, followers, growth_30d").in("id", part).order("id"), creatorIds),
      fetchPageIds((part) => supabase.from("prospects").select(PROSPECT_FIELDS).in("tubular_id", part).order("tubular_id"), prospectIds),
    ]);
    const promotedBy = await linkPromoted(prospects ?? []);
    const cBy = {}; for (const c of creators ?? []) cBy[c.id] = c;
    const pBy = {}; for (const p of prospects ?? []) pBy[p.tubular_id] = p;

    const items = (rows ?? []).map((r) => {
      if (r.creator_id) {
        const c = cBy[r.creator_id] || {};
        return { creator_id: r.creator_id, name: c.name, handle: c.handle, platform: c.platform, followers: c.followers, growth_30: c.growth_30d, eng_rate: null, match_score: r.match_score, rationale: r.rationale, status: "promovido" };
      }
      const p = pBy[r.prospect_id] || {};
      return { tubular_id: r.prospect_id, name: p.name, handle: p.handle, platform: p.platform, followers: p.followers, growth_30: p.growth_30, eng_rate: p.eng_rate, mini_score: p.mini_score, thumbnail: p.thumbnail, match_score: r.match_score, rationale: r.rationale, creator_id: promotedBy[r.prospect_id] || null, status: promotedBy[r.prospect_id] ? "promovido" : (p.status || "novo"), genre: p.genre, termo: p.termo, post_url: p.post_url, views_total: p.views_total, uploads_90: p.uploads_90, last_upload: p.last_upload };
    });
    const noRadar = items.filter((it) => it.creator_id || it.status === "promovido").length;
    // Descoberta mostra apenas quem NÃO está no radar ainda (decisão do cliente)
    const foraDoRadar = items.filter((it) => !(it.creator_id || it.status === "promovido"));

    return (
      <div className="wrap">
        <section className="hero" style={{ padding: "44px 0 20px" }}>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)" }}>Descobertas <em>do briefing</em></h1>
          <p>Pré-score da campanha <strong>{campaign?.name || "—"}</strong>. Estas são sugestões cruzadas com o briefing — <strong>ainda não passaram pela análise detalhada</strong>. Selecione quais valem o aprofundamento e clique em <em>Evoluir para análise detalhada</em>.</p>
        </section>

        <div className="funnel-steps">
          <span className="funnel-step done">1 · Briefing</span>
          <span className="funnel-arrow">→</span>
          <span className="funnel-step current">2 · Descoberta (pré-score)</span>
          <span className="funnel-arrow">→</span>
          <span className="funnel-step">3 · Análise detalhada</span>
        </div>

        <section className="stats" style={{ marginTop: 18 }}>
          <div className="stat"><div className="n">{items.length}</div><div className="l">Sugestões no pré-score</div></div>
          <div className="stat"><div className="n">{noRadar}</div><div className="l">Já no radar</div></div>
          <div className="stat"><div className="n">{foraDoRadar.length}</div><div className="l">Fora do radar</div></div>
          <div className="stat"><div className="n">{items[0]?.match_score != null ? Number(items[0].match_score).toFixed(0) : "—"}</div><div className="l">Maior match</div></div>
        </section>

        {foraDoRadar.length === 0 && items.length > 0
          ? <div className="empty" style={{ marginTop: 18 }}>Todas as creators sugeridas por este briefing já estão no radar. ✓</div>
          : <DiscoverySelection items={foraDoRadar} campaignId={campaignId} campaignName={campaign?.name || null} hoje={hojeISO} showFonte={isAdmin} {...selProps} />}

        <footer className="footer"><span>KOLLECT by Snack</span><span>Funil Briefing → Descoberta → Análise · Confidencial</span></footer>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODO B — universo do funil (varredura contínua)
  // ─────────────────────────────────────────────────────────────────────────
  // Ordem por MÉRITO, não por procedência.
  //
  // Ordenava-se por `fonte` antes do mini_score, o que contradiz o que a própria página
  // promete ("rankeado pelo mini-score") e, pior, escondia a descoberta nova: `tubular-video`
  // é a última fonte por ordem alfabética, portanto tudo o que o motor novo grava aterrava na
  // última das ~208 páginas, onde ninguém vai. De que serve descobrir se não se vê.
  //
  // Os promovidos saem no SERVIDOR. Saíam depois de paginar, o que fazia a contagem do
  // cabeçalho não bater com o número de cartões na página.
  // Irrecuperáveis fora da vista (decisão do cliente, 03/ago/2026): candidato cujo @ não se
  // resolve não é promovível — o cartão só oferece um "Tentar de novo" que falha sempre — e
  // como ordenam por mini-score alto ficavam à cabeça da lista a esconder o que é acionável.
  // Só a família com VEREDICTO (`sem_handle:irrecuperavel:<data>`, re-testada com o resolvedor
  // bom — ver docs/handles-irrecuperaveis.md) sai; o `sem_handle` simples falhou uma vez e
  // merece outra, portanto continua visível. Ficam na base e reabrem-se com um update.
  let query = supabase.from("prospects").select(PROSPECT_FIELDS, { count: "exact" })
    .neq("status", "substituida_ic").neq("status", "promovido")
    .not("status", "like", "sem_handle:irrecuperavel%")
    // escritos pela importação em lote: o handle já está no radar / outro prospect com o
    // mesmo handle foi promovido — mostrá-los seria oferecer uma re-promoção destrutiva
    .not("status", "like", "ja_no_radar:%").not("status", "like", "duplicado_handle:%");
  // busca contra name_norm (coluna gerada, NFKD dobrado) e não contra name: metade dos
  // nomes vem em unicode decorativo e o ilike não o desfaz — ver lib/text.js
  if (q) query = query.ilike("name_norm", `%${fold(q)}%`);
  if (min) query = query.gte("followers", min);
  if (max) query = query.lte("followers", max);
  if (desde) query = query.gte("descoberto_em", diaISO(desde - 1));
  if (termosSel.length) query = query.in("termo", termosSel);
  if (ord === "data") query = query.order("descoberto_em", { ascending: false });
  const pagePromise = Promise.resolve(query
    .order("mini_score", { ascending: false, nullsFirst: false })
    .order("tubular_id", { ascending: true }) // desempate estável: sem isto a paginação repete e salta linhas
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1))
    .then(async ({ data, count, error }) => {
      if (error || !Array.isArray(data)) throw new Error("Não foi possível carregar as descobertas");
      return { prospects: data, count, creatorBy: await linkPromoted(data) };
    });

  // Totais e termos são globais, reunidos numa leitura com cache de 60s. Preserva a
  // régua histórica de lib/funil.js; o total do filtro vem da consulta fresca acima.
  const [{ prospects, count, creatorBy }, { funil, termos: termoRows }, selProps] = await Promise.all([
    pagePromise, painelResumo(hojeISO), selectionPromise,
  ]);

  // Opções do filtro de termo (view prospect_termos), por volume descendente. Ordenava
  // por colheita mais recente, mas isso enterrava os buckets gigantes de junho (ai:*,
  // sweep, beauty — ~2/3 do universo, com chaves de motor em vez de termos livres) no
  // fundo do painel, e o filtro parecia não ter o universo todo. Os termos somam 100%
  // das descobertas: toda a fonte grava termo.
  const items = (prospects || []).map((p) => ({
    tubular_id: p.tubular_id, name: p.name, handle: p.handle, platform: p.platform,
    followers: p.followers, growth_30: p.growth_30, eng_rate: p.eng_rate, mini_score: p.mini_score,
    rising_star: p.rising_star, thumbnail: p.thumbnail, status: p.status, creator_id: creatorBy[p.tubular_id] || null,
    descoberto_em: p.descoberto_em, fonte: p.fonte,
    // contexto extra do card (pedido do operador, jul/2026): nicho, o vídeo que a
    // descobriu, volume e cadência — o que a base já sabe sobre o perfil
    genre: p.genre, termo: p.termo, post_url: p.post_url,
    views_total: p.views_total, uploads_90: p.uploads_90, last_upload: p.last_upload,
  }));

  // Descoberta mostra apenas quem ainda NÃO está no radar (decisão do cliente)
  const foraDoRadar = items.filter((it) => !it.creator_id && it.status !== "promovido");

  const filtrados = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(filtrados / PAGE_SIZE));
  const qs = (p) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q); if (min) u.set("min", String(min)); if (max) u.set("max", String(max));
    if (desde) u.set("desde", String(desde));
    for (const t of termosSel) u.append("termo", t);
    if (ord === "data") u.set("ord", ord);
    u.set("page", String(p));
    return `/descobertas?${u.toString()}`;
  };

  return (
    <div className="wrap">
      <section className="hero" style={{ padding: "44px 0 20px" }}>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>Descobertas <em>do funil</em></h1>
        <p>O universo beauty Brasil em varredura contínua — rankeado pelo mini-score. Selecione creators e clique em <em>Evoluir para análise detalhada</em> pra processar só as escolhidas (transcrição + análise) e agrupá-las numa lista nomeada.</p>
      </section>

      <div className="funnel-steps">
        <span className="funnel-step current">Descoberta (pré-score)</span>
        <span className="funnel-arrow">→</span>
        <span className="funnel-step">Análise detalhada</span>
        <Link href="/listas" className="chip" style={{ marginLeft: "auto" }}>Ver listas →</Link>
      </div>

      {/* Duas descobertas, dois motores (set/2026): a A procura por CONTEÚDO (vídeos recentes,
          v3/video.search — paga vídeos únicos); a B procura por PERFIL (v4/creator.search —
          só unidades, traz o @). A B nasceu quando o teto mensal de vídeos únicos fechou a A
          até ao início do mês; ver o cabeçalho de /api/discover-perfil. */}
      <DiscoveryRunner />
      <DiscoveryPerfilRunner />
      <PromoteRunner />

      {/* Os números ficam colados à pesquisa, por baixo dos painéis de corrida (pedido de
          03/09/2026): "No filtro atual" descreve a lista que a pesquisa filtra, e a faixa
          estava separada dela pelos dois painéis de operação. Sem margem inferior: é a
          pesquisa (margem própria de 22px) que dita a distância, e as duas leem-se como um bloco. */}
      <FunilStats {...funil} filtrados={filtrados} />

      <ProspectSearch q={q} min={min || ""} max={max || ""} desde={desde || ""} ord={ord} termosSel={termosSel} termos={termoRows ?? []} />

      <DiscoverySelection items={foraDoRadar} pageOffset={(page - 1) * PAGE_SIZE} hoje={hojeISO} showFonte={isAdmin} {...selProps} />

      {lastPage > 1 && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "26px 0" }}>
          {page > 1 && <Link className="chip" href={qs(page - 1)}>← Anterior</Link>}
          <span className="chip" style={{ opacity: 0.7 }}>página {page} de {lastPage}</span>
          {page < lastPage && <Link className="chip" href={qs(page + 1)}>Próxima →</Link>}
        </div>
      )}

      <footer className="footer"><span>KOLLECT by Snack</span><span>Funil de descoberta · Confidencial</span></footer>
    </div>
  );
}
