import Link from "next/link";
import { supabaseServer as supabase } from "@/lib/supabase";
import CampaignStatus from "@/components/CampaignStatus";
import CampaignRemove from "@/components/CampaignRemove";
import CampaignDelete from "@/components/CampaignDelete";
import CampaignShare from "@/components/CampaignShare";
import { sessionRole, veCampanha, mandaNaCampanha } from "@/lib/auth-server";
import CampaignActions from "@/components/CampaignActions";
import PromoteButton from "@/components/PromoteButton";
import { CLIENTS, DEFAULT_CLIENT } from "@/lib/clients";
import { TAG_LABEL } from "@/lib/casting";
import { lerCampanha, lerLinhas, montarCasting, montarCard, filtrarVista, linhasIniciais, resumoLinha, ehUuid, fmt, POR_PAGINA } from "@/lib/casting-linhas";
import ListaCasting from "@/components/ListaCasting";
import MaisNomes from "@/components/MaisNomes";
import BigNumbers from "@/components/BigNumbers";
import BarraBusca from "@/components/BarraBusca";
import AvatarImg from "@/components/AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";
import BriefingContexto from "@/components/BriefingContexto";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * CASTING DE UM BRIEFING — a lista de nomes que o briefing trouxe, com a evidência de cada um.
 *
 * Feedback do cliente (docs/Kollect - Feedbacks.pdf, set/2026, pontos 7–12): a ferramenta
 * não decide, organiza. Saíram o score (calculado, mas invisível), as estratégias
 * (Balanced/Authority/Discovery/Scale), o bloco "Top recommended", as classes secundárias
 * (Hidden Gem, Brand Safe, Watchlist, Out of Territory) e os estados aprovada/descartada.
 * Ficam três tags — KOL, Rising Star, Pool — e uma tabela de evidências: território,
 * seguidores, engajamento, consistência, público. A decisão é "adicionar a uma squad".
 *
 * Contas da mesma pessoa (person_key) aparecem uma vez (ponto 7): a linha é a conta com
 * melhor match, e as outras vão escritas ao lado, com os seguidores somados.
 * Atualização 16/09/2026: o indicador visível conta requisitos confirmados do briefing.
 * Score KOL e match interno continuam ocultos. Os dados ficam na linha expansível.
 *
 * Rodada 2, Fase 1 (21/09/2026; D2 e D5 ainda sem resposta do cliente — seguem as propostas):
 *  - F1.4/F1.9: a ordem volta a ser a aderência ao briefing (campaign_creators.match_score,
 *    DESC), escrita no topo da lista; o número não aparece. Sai o "X/100" composto: a linha
 *    diz "N de M requisitos", que já não manda na ordem.
 *  - F1.5: colunas Seguidores · Engagement rate (eng ÷ views) · Média de comentários.
 *  - F1.6: seleção múltipla + barra fixa para squads (components/SelecaoCreators.js).
 *  - F1.7/F1.8: números por rede, publi e total (creators.metricas_rede) e rede mais forte
 *    (lib/rede-forte.js) no card aberto.
 *  - F1.3: «Mais nomes» (components/MaisNomes.js) com menos de 20 nomes ou lista vazia.
 *
 * Rodada 2, Fase 2 (F2.5): filtros (tipo, q) e a linha expandida (?aberto=<creator_id>) ficam
 * no URL, para o «voltar» do browser ou do squad restaurar a vista; a abertura do briefing é
 * registada no servidor a partir de qualquer entrada (components/BriefingContexto.js).
 *
 * Paginação 20 a 20 (22/09/2026): medido em produção, a página demorava ~2,2 s e mandava
 * 3,6 MB de HTML — as ~150 linhas com o card aberto inteiro, fechado ou não, mais os dados
 * do CSV e da defesa. Agora desenha só o resumo das primeiras 20 linhas da vista
 * (components/ListaCasting.js carrega as seguintes e o card de cada uma ao abrir) e o CSV/
 * defesa pedem os dados no clique (/api/campanha-export). A montagem — filtros, dedupe por
 * pessoa, ordem, números — saiu para lib/casting-linhas.js, a mesma nas rotas.
 */
export default async function Campanha(props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const id = params.id;
  const client = CLIENTS.some((x) => x.id === searchParams?.cliente) ? searchParams.cliente : DEFAULT_CLIENT;
  // linha expandida vinda do URL (F2.5); só um uuid, nunca texto livre no id do DOM
  const abertoId = ehUuid(searchParams?.aberto) ? String(searchParams.aberto) : null;
  const [{ user, role }, { data: camp }, rows, { data: listaLigada }] = await Promise.all([
    sessionRole(),
    lerCampanha(supabase, id),
    lerLinhas(supabase, id),
    supabase.from("lists").select("id, name").eq("campaign_id", id).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!camp) return <div className="wrap"><div className="empty">Briefing não encontrado, ou não partilhado consigo — peça ao dono para o partilhar.</div></div>;
  // Briefings são individuais e partilháveis (set/2026): a lista já não mostrava os dos
  // outros, mas o URL abria — esconder o link não fecha a porta. Ver soMeus/veCampanha.
  const isAdmin = role === "admin";
  if (!veCampanha(camp, user?.id, isAdmin)) {
    // a mesma frase do "não encontrado": um id alheio não deve confirmar que o briefing existe
    // (pentest set/2026, "Exposure of Sensitive Information")
    return <div className="wrap"><div className="empty">Briefing não encontrado, ou não partilhado consigo — peça ao dono para o partilhar.</div></div>;
  }
  const manda = mandaNaCampanha(camp, user?.id, isAdmin);

  // o card da linha aberta no URL vem já montado (o «voltar» do squad reabre-a sem esperar);
  // se falhar, a lista pede-o sozinha (components/ListaCasting.js)
  const [ctx, cardAberto] = await Promise.all([
    montarCasting(supabase, camp, rows),
    abertoId ? montarCard(supabase, camp, abertoId).catch(() => null) : null,
  ]);
  const { p, pBy, lista, terrLabel, kw, nKol, nRising, nPool, nCompletos, rationale } = ctx;
  const terrDetected = kw.slice(0, 7).join(", ") || (p.territorio || terrLabel);
  const objetivo = p.objetivo || "—";

  // foto morta → inicial do nome, nunca a estrela (B4, set/2026; components/AvatarImg.js)
  const Avatar = ({ url, size = 34, nome }) => (
    <AvatarImg src={avatarSrc(url)} nome={nome} size={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--line-strong)", flex: "0 0 auto" }} />
  );

  const lblS = { fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 4 };
  const valS = { fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 };

  const sugerida = listaLigada ? { id: listaLigada.id, name: listaLigada.name } : null;

  // Filtro por tag e busca por nome/@ (feedback rodada 2): a vista é montada na lib, igual
  // na página e em /api/campanha-linhas.
  const { tipoFilter, q, termo, porTipo, mostradas, funilVisivel } = filtrarVista(ctx, { tipo: searchParams?.tipo, q: searchParams?.q });
  const FILTERS = [["", "Todos", lista.length], ["kol", "KOL", nKol], ["rising_star", "Rising Star", nRising], ["pool", "Pool", nPool]];
  const qhref = (k) => `/campanha/${id}?cliente=${client}${k ? `&tipo=${k}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const limparHref = `/campanha/${id}?cliente=${client}${tipoFilter ? `&tipo=${tipoFilter}` : ""}`;
  // «Mais nomes» (F1.3, contrato com components/MaisNomes.js): lista curta ou vazia; não
  // aparece quando a lista está filtrada por nome, onde "poucos" é o efeito do filtro.
  const MAIS_NOMES_ATE = 20;

  // só o resumo das primeiras 20 linhas (ou até à aberta no URL); o resto vem ao pedido
  const iniciais = mostradas.slice(0, linhasIniciais(mostradas, abertoId)).map((r) => resumoLinha(ctx, r));
  const cardsIniciais = cardAberto && iniciais.some((l) => l.creator.id === cardAberto.creatorId) ? { [cardAberto.creatorId]: cardAberto } : {};

  const FunilCard = (r) => {
    const pr = pBy[r.prospect_id];
    return (
      <div key={r.id} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Avatar url={pr.thumbnail} size={56} nome={pr.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.name}</div>
            <div style={{ fontSize: 12, color: "var(--gold)", marginTop: 3 }}>✦ A analisar · do funil</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{fmt(pr.followers)} seguidores · {r.rationale}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PromoteButton tubularId={r.prospect_id} status={pr.status} />
          <CampaignStatus rowId={r.id} status={r.status} />
          <CampaignRemove rowId={r.id} nome={pr.name} />
        </div>
      </div>
    );
  };

  return (
    <div className="wrap">
      <BriefingContexto campaignId={id} aberto={abertoId} />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "18px 0 0" }}>
        {/* legado (sem dono) é comum a todos por construção — não há nada para partilhar */}
        {camp.user_id == null
          ? <span className="chip-sm">visível a toda a equipa</span>
          : manda
            ? <CampaignShare campaignId={id} shared={camp.shared_with ?? []} />
            : <span className="chip-sm">partilhado consigo</span>}
        {manda && <CampaignDelete campaignId={id} name={camp.name} label="Apagar briefing" redirectTo="/" />}
      </div>

      {/* DOBRA 1 — header compacto + ações */}
      <section style={{ padding: "8px 0 0" }}>
        <div style={{ fontSize: 10.5, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--gold)" }}>Resultados do briefing</div>
        <h1 style={{ fontSize: "clamp(24px, 3.5vw, 38px)", margin: "6px 0 0" }}>Creators</h1>
        <p style={{ fontSize: 17, marginTop: 8, fontWeight: 500 }}>{camp.name}</p>
        {/* big numbers antes da explicação (feedback rodada 2) */}
        <div style={{ marginTop: 16, maxWidth: 760 }}>
          <BigNumbers compacto ariaLabel="Resumo do casting" items={[
            { label: "Creators", value: lista.length.toLocaleString("pt-BR"), destaque: true },
            { label: "Todos os requisitos", value: nCompletos.toLocaleString("pt-BR"), title: "Creators com todos os requisitos do briefing atingidos" },
            { label: "KOL", value: nKol.toLocaleString("pt-BR") },
            { label: "Rising Star", value: nRising.toLocaleString("pt-BR") },
            { label: "Pool", value: nPool.toLocaleString("pt-BR") },
          ]} />
        </div>
        <p style={{ maxWidth: 760, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-dim)", marginTop: 14 }}>
          {lista.length} creators com aderência ao território de <b style={{ color: "var(--text)" }}>{terrLabel}</b>{kw.length ? ` (${kw.slice(0, 4).join(", ")})` : ""}.
          {listaLigada ? <> Squad list deste briefing: <Link href={`/listas?id=${listaLigada.id}`} style={{ color: "var(--gold-bright)" }}>{listaLigada.name} →</Link></> : null}
        </p>
        <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>A lista está ordenada por aderência ao briefing. Cada linha mostra quantos requisitos do briefing estão confirmados; expanda-a para ver a evidência e os números por rede.</p>
        <CampaignActions campaignId={id} campaignName={camp.name} rationale={rationale} tipo={tipoFilter} />
      </section>

      {/* busca por nome/@ — a mesma cápsula das outras páginas; GET para o filtro ficar no URL */}
      <div style={{ marginTop: 20 }}>
        <BarraBusca
          name="q"
          placeholder="Filtrar por nome ou @handle"
          ariaLabel="Filtrar creators do briefing por nome ou @handle"
          acao="Filtrar"
          inputProps={{ defaultValue: q }}
          formProps={{ method: "get", action: `/campanha/${id}` }}
          extra={<>
            <input type="hidden" name="cliente" value={client} />
            {tipoFilter ? <input type="hidden" name="tipo" value={tipoFilter} /> : null}
          </>}
        />
      </div>

      {/* filtros sticky por tag */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", padding: "12px 0", marginTop: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map(([k, lab, n]) => {
          const active = (k === "" && !tipoFilter) || k === tipoFilter;
          return (
            <Link key={k || "todos"} href={qhref(k)} className="chip" style={active ? { borderColor: "var(--gold)", color: "var(--gold-bright)", background: "var(--card)" } : {}}>
              {lab} <span style={{ color: active ? "var(--gold)" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{n}</span>
            </Link>
          );
        })}
      </div>

      {/* DOBRA 2 — a lista */}
      {mostradas.length ? (
        <section style={{ marginTop: 18 }} aria-label="Resultados do briefing">
          {termo ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "0 0 12px", fontSize: 12.5, color: "var(--text-dim)" }}>
              <span><b style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{mostradas.length}</b> de {porTipo.length} creators para «{q}»</span>
              <Link href={limparHref} style={{ color: "var(--gold-bright)", fontSize: 12 }}>limpar busca ×</Link>
            </div>
          ) : null}
          {/* a chave refaz a lista quando o servidor manda outra vista (filtro, busca, remoção,
              «Mais nomes»); um router.refresh que não muda as linhas mantém o que já carregou */}
          <ListaCasting key={`${mostradas.length}:${iniciais.map((l) => l.rowId).join(",")}`}
            campaignId={id} client={client} squad={sugerida}
            total={mostradas.length} iniciais={iniciais} cardsIniciais={cardsIniciais}
            abertoId={abertoId} tipo={tipoFilter} q={q} porPagina={POR_PAGINA} />
          {!termo && lista.length < MAIS_NOMES_ATE ? <div style={{ marginTop: 16 }}><MaisNomes campaignId={id} visiveis={lista.length} /></div> : null}
        </section>
      ) : (
        <div className="empty" style={{ marginTop: 22 }}>
          {termo
            ? <>Nenhuma creator {tipoFilter ? `${TAG_LABEL[tipoFilter]} ` : ""}corresponde a «{q}». <Link href={limparHref} style={{ color: "var(--gold-bright)" }}>Limpar busca</Link></>
            : tipoFilter ? `Nenhuma creator com a tag ${TAG_LABEL[tipoFilter]} neste casting.` : "Nenhuma creator analisada no casting ainda."}
          {!termo && !tipoFilter ? <div style={{ marginTop: 14 }}><MaisNomes campaignId={id} visiveis={lista.length} /></div> : null}
        </div>
      )}

      {!tipoFilter && funilVisivel.length ? (
        <section style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)" }}>
            <span style={{ color: "var(--gold)" }}>✦</span> Do funil · a analisar <span style={{ color: "var(--text-faint)" }}>· {funilVisivel.length}</span>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>{funilVisivel.map(FunilCard)}</div>
        </section>
      ) : null}

      {/* DOBRA 3 — Briefing (colapsado) */}
      <section style={{ marginTop: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          <span style={{ color: "var(--gold)" }}>◆</span> Briefing
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>

        {camp.briefing ? (
          <details style={{ marginBottom: 12, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 16px" }}>
            <summary style={{ cursor: "pointer", fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", listStyle: "none" }}>❝ Briefing interpretado <span style={{ color: "var(--text-faint)" }}>· somente leitura</span></summary>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 13.5, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>{camp.briefing}</div>
          </details>
        ) : null}

        <details style={{ marginBottom: 12, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 16px" }}>
          <summary style={{ cursor: "pointer", fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-dim)", listStyle: "none" }}>◆ Como a lista foi montada</summary>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--text)", margin: 0, maxWidth: 900 }}>{rationale}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 16 }}>
              <div><div style={lblS}>Território detectado</div><div style={valS}>{terrDetected}</div></div>
              <div><div style={lblS}>Objetivo</div><div style={valS}>{objetivo}</div></div>
              <div><div style={lblS}>Plataforma</div><div style={valS}>{p.plataforma === "tiktok" ? "TikTok" : p.plataforma === "instagram" ? "Instagram" : "TikTok e Instagram"}</div></div>
              {p.marca_alvo && p.marca_alvo !== "nenhuma" ? <div><div style={lblS}>Marca</div><div style={valS}>{p.marca_alvo}</div></div> : null}
              {p.referencia ? <div><div style={lblS}>Perfil de referência</div><div style={valS}>
                <a href={p.referencia} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold-bright)" }}>{p.referencia_creator?.handle ? `@${p.referencia_creator.handle}` : p.referencia}</a>
                {p.referencia_creator?.encontrado
                  ? <> · <Link href={`/creator/${p.referencia_creator.id}`} style={{ color: "var(--gold)" }}>ficha →</Link>{p.referencia_creator.sub_nichos?.length ? <div style={{ marginTop: 4 }}>sub-nichos usados no match: {p.referencia_creator.sub_nichos.join(", ")}</div> : null}</>
                  : p.referencia_creator ? <div style={{ marginTop: 4, color: "var(--gold-bright)" }}>não está no radar — avalie-o em <Link href="/creators-hub" style={{ color: "var(--gold-bright)" }}>Creators Hub</Link> e atualize o casting para ele pesar no match</div> : null}
              </div></div> : null}
            </div>
          </div>
        </details>
      </section>

      <footer className="footer" style={{ marginTop: 36 }}>
        <span>KOLLECT by Snack</span>
        <span>Briefing Match · Confidencial</span>
      </footer>
    </div>
  );
}
