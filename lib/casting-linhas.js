// Linhas do casting de um briefing (página /campanha/[id]) — montagem partilhada entre a
// página e as rotas que a paginam (/api/campanha-linhas, /api/campanha-card,
// /api/campanha-export).
//
// Medição em produção (22/09/2026): a página desenhava as ~150 linhas com o card aberto
// inteiro (big numbers, tabela por rede, requisitos com evidência, ações) mesmo fechadas,
// mais os dados do CSV e da defesa — 3,6 MB de HTML e ~2,2 s no servidor. Pedido do Rui:
// "paginação 20 a 20". Agora a página desenha só o RESUMO das primeiras 20 linhas; as
// seguintes chegam de 20 em 20 e o card de cada linha vem quando se abre.
//
// Tudo o que decide quem aparece, por que ordem e com que números vive AQUI, uma vez:
// filtro por tag, busca por nome, dedupe por pessoa (person_key), ordem por lote e
// aderência ao briefing, contagens do topo. Página e rotas chamam as mesmas funções — a
// segunda página nunca pode ordenar ou formatar diferente da primeira.
//
// Sem JSX e sem imports "@/": os testes (node --test) importam este módulo diretamente.
import { ksRamoDe, roleDe as roleDeCasting, contaNoCasting, tagDe, TAG_LABEL, TAG_ORDER } from "./casting.js";
import { r2 } from "./numeros.js";
import { partilhaSubNicho } from "./referencia.js";
import { fetchPageRows, fetchPageIds } from "./page-data.js";
import { fetchCampaignDetail } from "./campaign-detail.js";
import { avaliarRequisitos } from "./briefing-requirements.js";
import { redeMaisForte, objetivoDe } from "./rede-forte.js";

export const POR_PAGINA = 20;
export const MAX_POR_PAGINA = 50;
export const CAMPOS_CAMPANHA = "id,name,briefing,parsed,user_id,shared_with";
const CAMPOS_LINHAS = "id,creator_id,prospect_id,kind,match_score,rationale,status,campaign_role,lote";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v) => UUID.test(String(v || ""));

export const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));

// território-strict: infere o nicho do briefing pra separar "do território" de "fora do território"
const NICHE_TERMS = {
  cabelo: ["cabelo", "cabelos", "capilar", "hair", "fios", "cacho", "cachos", "loiro", "mechas", "liso", "progressiva"],
  maquiagem: ["maquiagem", "make", "makeup", "batom", "base", "rímel", "rimel", "sombra", "contorno", "blush", "delineado"],
  skincare: ["skincare", "skin care", "pele", "dermo", "sérum", "serum", "hidratante", "acne", "poros", "protetor solar"],
  unhas: ["unha", "unhas", "nail", "nails", "esmalte", "manicure", "nail art"],
  perfume: ["perfume", "perfumaria", "fragrância", "fragrancia", "fragrance", "cheiro", "perfumes"],
  cilios: ["cílios", "cilios", "lash", "lashes", "extensão de cílios", "máscara de cílios"],
  estetica: ["estética", "estetica", "botox", "preenchimento", "harmonização", "procedimento", "dermato"],
};
export const TERR_LABEL = { cabelo: "cabelo", maquiagem: "maquiagem", skincare: "skincare", unhas: "unhas", perfume: "perfume", cilios: "cílios", estetica: "estética" };
function bucketFromText(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase();
  let best = null, bestN = 0;
  for (const [b, terms] of Object.entries(NICHE_TERMS)) {
    const n = terms.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
    if (n > bestN) { bestN = n; best = b; }
  }
  return best;
}

/** Nicho do briefing pelo texto (keywords, território, nicho, briefing, nome); null se não der. */
export function territorioPorTexto(camp) {
  const p = camp?.parsed || {};
  return bucketFromText([(p.keywords ?? []).join(" "), p.territorio, p.nicho, camp?.briefing, camp?.name].filter(Boolean).join(" "));
}

// Sem pista no texto, o nicho mais comum entre as creators do casting (todas as linhas do
// radar, antes de qualquer corte).
function territorioPorRadar(buckets) {
  const cnt = {};
  for (const b of buckets) if (b && b !== "outros") cnt[b] = (cnt[b] || 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function territorio(bh) {
  const ns = bh?.nichos;
  if (!ns?.length) return null;
  const top = ns.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
  return { label: String(top.nicho).split(/[&/|,]/)[0].trim(), pct: Number(top.pct) };
}

const ROLE_PREFIXES = ["Authority Anchor", "Authority Lead", "Rising Bet", "Discovery Bet", "Hidden Opportunity", "Efficiency Play", "Safe Scale", "Scale Support", "Out of Territory", "Not Recommended"];
const semAcento = (t) => String(t || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
const pctTxt = (x) => x == null ? "—" : `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export const lerCampanha = (db, id) => db.from("campaigns").select(CAMPOS_CAMPANHA).eq("id", id).single();

/** Todas as linhas do casting, na ordem do banco (match DESC, id). `filtro` restringe a query. */
export const lerLinhas = (db, id, filtro = null) => fetchPageRows(() => {
  let q = db.from("campaign_creators").select(CAMPOS_LINHAS).eq("campaign_id", id);
  if (filtro) q = filtro(q);
  return q.order("match_score", { ascending: false }).order("id");
});

/**
 * Monta o casting a partir da campanha, das linhas e do detalhe (fetchCampaignDetail).
 * Puro: devolve as listas e os formatadores que a página e as rotas usam.
 * `nichosRadar`: buckets de nicho de todas as linhas do radar, quando o detalhe foi lido só
 * para parte do casting (card de uma linha) — é o fallback do território do briefing.
 */
export function prepararCasting(camp, rows, detalhe, { nichosRadar = null } = {}) {
  const { creators, prospects, promotedLink, snapBy, irmasAll } = detalhe;
  const cBy = {}; for (const c of creators ?? []) cBy[c.id] = c;
  const pBy = {}; for (const p of prospects ?? []) pBy[p.tubular_id] = p;

  // prospects do casting que já viraram creator no radar (link por tubular_id):
  // não devem aparecer em "Do funil · a analisar" — essa seção é só fora do radar (decisão do cliente)
  const promovidoNoRadar = new Set((promotedLink ?? []).map((x) => x.tubular_id));

  // Contas-irmãs fora do casting (a pessoa entrou por uma conta, mas tem outra no radar):
  // vão escritas na linha, para a equipa saber que o TikTok e o Instagram são a mesma pessoa.
  const irmasPorKey = {};
  for (const c of irmasAll ?? []) (irmasPorKey[c.person_key] ||= []).push(c);
  const p = camp.parsed || {};

  const radar = (rows || []).filter((r) => r.creator_id && cBy[r.creator_id]);
  const funil = (rows || []).filter((r) =>
    r.prospect_id && pBy[r.prospect_id]
    && pBy[r.prospect_id].status !== "promovido"
    && !promovidoNoRadar.has(r.prospect_id)
  );
  // tag e visibilidade no casting: regras partilhadas com o cartão da lista de campanhas
  // (lib/casting.js) — era a duplicação que fazia o cartão dizer 190 e a ficha 150.
  const ksRamo = ksRamoDe(p);
  const roleDe = (r) => roleDeCasting(r, cBy[r.creator_id], ksRamo);
  const tagOf = (r) => tagDe(r, cBy[r.creator_id], ksRamo);

  // resultado do briefing: ordenado por match (DESC do banco), SEM não-recomendadas e SEM
  // fora do território — a lista é de quem adere ao briefing, não de todo o radar
  const visiveis = radar.filter((r) => contaNoCasting(r, cBy[r.creator_id], ksRamo) && roleDe(r) !== "out_of_territory");

  // uma linha por pessoa (person_key): fica a conta com melhor match; as outras vão na linha
  const porPessoa = new Map();
  for (const r of visiveis) {
    const c = cBy[r.creator_id];
    const k = c.person_key || `id:${c.id}`;
    const cur = porPessoa.get(k);
    if (!cur || (r.match_score ?? 0) > (cur.match_score ?? 0)) porPessoa.set(k, r);
  }
  // "Mais nomes" (F1.3) acrescenta lotes: o casting original (lote 0) primeiro, cada clique
  // no fim — quem já leu a lista não a vê reordenar. Dentro do lote, aderência ao briefing.
  const lista = [...porPessoa.values()].sort((a, b) => (a.lote ?? 0) - (b.lote ?? 0) || (b.match_score ?? 0) - (a.match_score ?? 0));
  const contasDe = (c) => (c.person_key ? (irmasPorKey[c.person_key] ?? []) : []).filter((x) => x.id !== c.id);
  const seguidoresDe = (c) => (c.followers || 0) + contasDe(c).reduce((s, x) => s + (x.followers || 0), 0);
  // Requisitos só se mostram ("N de M"); a ordem é a aderência ao briefing, acima (F1.4, D2).
  const avaliacoes = new Map(lista.map((r) => [r.id, avaliarRequisitos(p, cBy[r.creator_id], { contas: contasDe(cBy[r.creator_id]) })]));
  const reqTxt = (a) => a.total ? `${a.atingidos} de ${a.total}` : "—";

  const briefingTerritory = territorioPorTexto(camp)
    || territorioPorRadar(nichosRadar ?? radar.map((r) => cBy[r.creator_id]?.kol_screen?.metricas?.niche_bucket));
  const terrLabel = briefingTerritory ? (TERR_LABEL[briefingTerritory] || briefingTerritory) : "beleza";
  const kw = p.keywords ?? [];

  const nPor = (t) => lista.filter((r) => tagOf(r) === t).length;
  const nKol = nPor("kol"), nRising = nPor("rising_star"), nPool = nPor("pool");
  const nCompletos = lista.filter((r) => { const a = avaliacoes.get(r.id); return a.total > 0 && a.atingidos === a.total; }).length;
  const rationale = `Para ${camp.name}, a lista reúne creators com conteúdo recorrente no território de ${terrLabel}${kw.length ? ` (${kw.slice(0, 4).join(", ")})` : ""}: ${nKol} ${nKol === 1 ? "KOL" : "KOLs"} do território, ${nRising} ${nRising === 1 ? "Rising Star" : "Rising Stars"} em aceleração e ${nPool} no pool. Para cada nome, a linha mostra os requisitos e a evidência — território, seguidores, engajamento, consistência e público — para a equipa decidir quem faz sentido para o projeto.`;

  const terrShow = (c) => {
    const t = territorio(c.brand_history);
    if (t) return `${t.label} ${Math.round(t.pct)}%`;
    const b = c.kol_screen?.metricas?.niche_bucket;
    const d = c.kol_screen?.metricas?.niche_density;
    if (b && b !== "outros") return `${TERR_LABEL[b] || b}${d != null ? ` ${Math.round(d)}%` : ""}`;
    return terrLabel;
  };
  const consistShow = (c) => { const v = c.kol_screen?.metricas?.consistency_pct; return v == null ? "—" : `${Math.round(v)}%`; };
  // comentários por peça e face à faixa (creators.conversa, /api/conversa) — o "média de
  // comentários" e a "compatibilidade" que o cliente pediu na lista (ponto 10); no card vai
  // como big number (conversaNum, abaixo), no CSV como texto
  const conversaCsv = (c) => { const v = c.conversa?.volume; return v ? `${v.media_comentarios}${v.indice_faixa != null ? ` (${v.indice_faixa}× faixa)` : ""}` : "—"; };
  const publicoShow = (c) => {
    const f = c.audience?.mulheres_pct;
    if (f == null) return "—";
    return p.publico_alvo === "masculino" ? `${Math.round(100 - Number(f))}% masc.` : `${Math.round(Number(f))}% fem.`;
  };
  // castings anteriores a set/2026 guardam "aderência ao brief 65" e "Marca 72/100" no texto:
  // réguas internas que o cliente lê como score — saem na apresentação
  const whyOf = (r) => {
    let t = (r.rationale && String(r.rationale).trim()) || `Conteúdo recorrente no território de ${terrLabel}.`;
    for (const pfx of ROLE_PREFIXES) { if (t.startsWith(pfx + " — ")) { t = t.slice(pfx.length + 3); break; } }
    t = t.replace(/\s*·\s*aderência ao brief \d+/g, "")
      .replace(/\s*·\s*aderência (feminino|masculino) (\d+)\/100/g, (_, g) => ` · audiência ${g === "feminino" ? "feminina" : "masculina"} confirmada`)
      .replace(/([A-Za-zÀ-ÿ'’ ]+?) \d+\/100 \((recomendada|watchlist|fit baixo|⚠ não recomendada)\)/g, (_, marca, vd) => `${marca.trim()}: ${vd === "watchlist" ? "a validar" : vd}`);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  };
  // Colunas da linha fechada (F1.5). Engagement rate: o da pessoa nos 90 dias
  // (metricas_rede, engajamentos ÷ views), senão o do último snapshot da conta; nunca sobre
  // seguidores (lib/engagement.js). Comentários: a leitura da conversa, senão a média das
  // peças dos 90 dias.
  const erDe = (c) => c.metricas_rede?.total?.eng_rate ?? (snapBy[c.id]?.eng_rate != null ? Number(snapBy[c.id].eng_rate) : null);
  const comentariosDe = (c) => c.conversa?.volume?.media_comentarios ?? c.metricas_rede?.total?.comentarios_media ?? null;

  return {
    camp, p, cBy, pBy, radar, funil, lista, avaliacoes, tagOf, contasDe, seguidoresDe, reqTxt,
    terrLabel, kw, nKol, nRising, nPool, nCompletos, rationale,
    terrShow, consistShow, conversaCsv, publicoShow, whyOf, erDe, comentariosDe, snapBy,
    objetivoBriefing: objetivoDe(p),
  };
}

/** Lê e monta o casting inteiro (página, linhas seguintes, exportação). */
export async function montarCasting(db, camp, rows) {
  const detalhe = await fetchCampaignDetail(db, rows, { leve: true });
  return prepararCasting(camp, rows, detalhe);
}

/**
 * A vista pedida: filtro por tag (?tipo=) e busca por nome/@ (?q=). A busca (feedback rodada 2,
 * "busca idêntica em todas as páginas") filtra as linhas já montadas, sem ir ao banco. Sem
 * acentos e sem maiúsculas; o @ inicial é ignorado. Também encontra a pessoa pelo @ de uma
 * conta ligada (a linha é uma por pessoa).
 */
export function filtrarVista(ctx, { tipo, q } = {}) {
  const tipoFilter = TAG_ORDER.includes(tipo) ? tipo : null;
  const porTipo = tipoFilter ? ctx.lista.filter((r) => ctx.tagOf(r) === tipoFilter) : ctx.lista;
  const qq = String(q ?? "").trim().slice(0, 80);
  const termo = semAcento(qq.replace(/^@+/, "")).trim();
  const bate = (...textos) => textos.some((t) => semAcento(String(t || "").replace(/^@+/, "")).includes(termo));
  const mostradas = termo
    ? porTipo.filter((r) => { const c = ctx.cBy[r.creator_id]; return bate(c.name, c.handle, ...ctx.contasDe(c).map((x) => x.handle)); })
    : porTipo;
  const funilVisivel = termo ? ctx.funil.filter((r) => bate(ctx.pBy[r.prospect_id]?.name)) : ctx.funil;
  return { tipoFilter, q: qq, termo, porTipo, mostradas, funilVisivel };
}

/** Fatia da vista; offset/limit saneados (limite entre 1 e MAX_POR_PAGINA). */
export function paginar(mostradas, offset = 0, limit = POR_PAGINA) {
  const o = Math.max(0, Math.floor(Number(offset) || 0));
  const l = Math.min(MAX_POR_PAGINA, Math.max(1, Math.floor(Number(limit) || POR_PAGINA)));
  return mostradas.slice(o, o + l);
}

/**
 * Quantas linhas a página desenha de início: uma página, ou as páginas até à linha aberta
 * no URL (?aberto=, F2.5), para o «voltar» do squad reencontrá-la na mesma posição.
 */
export function linhasIniciais(mostradas, abertoId = null, porPagina = POR_PAGINA) {
  const i = abertoId ? mostradas.findIndex((r) => r.creator_id === abertoId) : -1;
  return i < 0 ? Math.min(porPagina, mostradas.length) : Math.min(mostradas.length, Math.ceil((i + 1) / porPagina) * porPagina);
}

/** Resumo da linha fechada — só o que o <summary> desenha. Serializável. */
export function resumoLinha(ctx, r) {
  const c = ctx.cBy[r.creator_id];
  const a = ctx.avaliacoes.get(r.id);
  return {
    rowId: r.id,
    creator: { id: c.id, handle: c.handle ?? null, name: c.name ?? null, platform: c.platform ?? null, avatar_url: c.avatar_url ?? null },
    avaliacao: { total: a.total, atingidos: a.atingidos },
    tag: TAG_LABEL[ctx.tagOf(r)],
    reference: !!partilhaSubNicho(c.brand_history, ctx.p.referencia_creator),
    colunas: { seguidores: fmt(ctx.seguidoresDe(c)), er: pctTxt(ctx.erDe(c)), comentarios: fmt(ctx.comentariosDe(c)) },
  };
}

/**
 * Card aberto de uma linha (big numbers, rede mais forte, números por rede, porquê,
 * requisitos, contas, avisos, dados das ações). Serializável: a cor do sub dos comentários
 * vai como `subCor` e o componente pinta-a. Exige o detalhe COMPLETO (metricas_rede inteiro).
 */
export function cardLinha(ctx, r) {
  const c = ctx.cBy[r.creator_id];
  const outras = ctx.contasDe(c);
  const { snapBy, terrLabel, p } = ctx;
  // Big numbers do card aberto (feedback rodada 2): o número vem primeiro e grande, e o texto
  // que antes vinha colado ao valor ("12.18% eng/views", "5.11× faixa") desce para `sub`.
  // Os valores são os mesmos que a exportação usa (terrShow, consistShow, conversaCsv, publicoShow).
  const terrNum = () => {
    const t = territorio(c.brand_history);
    if (t) return { value: `${Math.round(t.pct)}%`, sub: t.label };
    const b = c.kol_screen?.metricas?.niche_bucket;
    const d = c.kol_screen?.metricas?.niche_density;
    if (b && b !== "outros") return d != null ? { value: `${Math.round(d)}%`, sub: TERR_LABEL[b] || b } : { value: TERR_LABEL[b] || b };
    return { value: terrLabel };
  };
  const engNum = () => {
    const ix = c.kol_screen?.metricas?.eng_index;
    const er = snapBy[c.id]?.eng_rate;
    if (ix != null) return { value: `${r2(ix)}×`, sub: `face aos pares${er != null ? ` · ${r2(Number(er))}% eng/views` : ""}` };
    if (er != null) return { value: `${r2(Number(er))}%`, sub: "eng/views" };
    return { value: null };
  };
  const conversaNum = () => {
    const v = c.conversa?.volume;
    if (!v) {
      const m = c.metricas_rede?.total?.comentarios_media;
      return m != null ? { value: fmt(m), sub: "média das peças, 90 dias" } : { value: null };
    }
    const partes = [v.indice_faixa != null ? `${v.indice_faixa}× faixa` : null, c.conversa?.conteudo?.pct_duvidas != null ? `${c.conversa.conteudo.pct_duvidas}% dúvidas` : null].filter(Boolean);
    const cor = v.indice_faixa == null ? undefined : v.indice_faixa >= 1.5 ? "var(--green)" : v.indice_faixa < 0.8 ? "var(--red)" : undefined;
    // `subCor` presente (mesmo null) = o sub é o da conversa, desenhado num <span> com a cor
    return { value: fmt(v.media_comentarios), sub: partes.length ? partes.join(" · ") : null, ...(partes.length ? { subCor: cor ?? null } : {}) };
  };
  const publicoNum = () => {
    const f = c.audience?.mulheres_pct;
    if (f == null) return { value: null };
    return p.publico_alvo === "masculino"
      ? { value: `${Math.round(100 - Number(f))}%`, sub: "audiência masculina" }
      : { value: `${Math.round(Number(f))}%`, sub: "audiência feminina" };
  };
  const consist = ctx.consistShow(c);
  const avisos = [];
  if (c.kol_screen?.disaster?.nivel === "medio" && !/Disaster check a rever/.test(r.rationale || "")) {
    avisos.push({ tipo: "rever", texto: `Disaster check a rever: ${(c.kol_screen.disaster.sinais || []).join(", ").toLowerCase()}.` });
  }
  if (c.kol_screen?.disaster?.nivel === "alto" && r.kind === "manual") {
    avisos.push({ tipo: "alto", texto: "Disaster check alto · creator incluído manualmente." });
  }
  // o composto interno (`score`) não sai do servidor: o cliente vê só "N de M" (F1.9/D2)
  const { score: _composto, ...avaliacao } = ctx.avaliacoes.get(r.id);
  return {
    creatorId: c.id,
    rowId: r.id,
    status: r.status ?? null,
    nome: c.name ?? null,
    handle: c.handle ?? null,
    avaliacao,
    numeros: [
      { label: "Território", ...terrNum() },
      { label: "Seguidores", value: fmt(ctx.seguidoresDe(c)), sub: outras.length ? `${outras.length + 1} contas somadas` : null },
      { label: "Engajamento", ...engNum() },
      { label: "Consistência", value: consist === "—" ? null : consist },
      { label: "Comentários por peça", ...conversaNum() },
      { label: "Público", ...publicoNum() },
    ],
    metricasRede: c.metricas_rede ?? null,
    redeForte: redeMaisForte(c.metricas_rede, { objetivo: ctx.objetivoBriefing, engIndex: c.kol_screen?.metricas?.eng_index, indiceFaixa: c.conversa?.volume?.indice_faixa }),
    justificativa: ctx.whyOf(r),
    contas: outras.length > 0 ? `Contas ligadas: ${outras.map((x) => `@${x.handle} · ${x.platform}`).join(" / ")}` : null,
    avisos,
  };
}

/** Linha do casting que a lista mostra para esta creator (a conta que representa a pessoa). */
export const linhaDoCreator = (ctx, creatorId) => ctx.lista.find((r) => r.creator_id === creatorId) ?? null;

/**
 * Card de UMA creator sem montar o casting inteiro: lê só as linhas dela, o detalhe
 * completo dela (irmãs incluídas) e, se o texto do briefing não disser o território, os
 * nichos do radar para o fallback — o mesmo prepararCasting/cardLinha da página.
 */
export async function montarCard(db, camp, creatorId) {
  const precisaRadar = !territorioPorTexto(camp);
  const [rows, todas] = await Promise.all([
    lerLinhas(db, camp.id, (q) => q.eq("creator_id", creatorId)),
    precisaRadar ? lerLinhas(db, camp.id, (q) => q.not("creator_id", "is", null)) : null,
  ]);
  const [detalhe, nichos] = await Promise.all([
    fetchCampaignDetail(db, rows),
    precisaRadar
      ? fetchPageIds((ids) => db.from("creators").select("id,niche_bucket:kol_screen->metricas->>niche_bucket").in("id", ids).order("id"), todas.map((r) => r.creator_id))
      : null,
  ]);
  let nichosRadar = null;
  if (precisaRadar) {
    const porId = new Map(nichos.map((c) => [c.id, c.niche_bucket]));
    nichosRadar = todas.filter((r) => porId.has(r.creator_id)).map((r) => porId.get(r.creator_id));
  }
  const ctx = prepararCasting(camp, rows, detalhe, { nichosRadar });
  const r = linhaDoCreator(ctx, creatorId);
  return r ? cardLinha(ctx, r) : null;
}

/** Dados do CSV e da defesa: a vista por tag (como antes); a busca por nome é só navegação. */
export function exportCasting(ctx, porTipo) {
  return porTipo.map((r) => {
    const c = ctx.cBy[r.creator_id] || {};
    const ix = c.kol_screen?.metricas?.eng_index, er = ctx.snapBy[c.id]?.eng_rate;
    const eng = [ix != null ? `${r2(ix)}× pares` : null, er != null ? `${r2(Number(er))}% eng/views` : null].filter(Boolean).join(" · ") || "—";
    // "N de M", sem o composto /100 (F1.9, proposta da D2)
    const com = ctx.conversaCsv(c) === "—" && ctx.comentariosDe(c) != null ? String(ctx.comentariosDe(c)) : ctx.conversaCsv(c);
    return { requisitos: ctx.reqTxt(ctx.avaliacoes.get(r.id)), name: c.name, handle: c.handle, tag: TAG_LABEL[ctx.tagOf(r)], territory: ctx.terrShow(c), followers: fmt(ctx.seguidoresDe(c)), er: pctTxt(ctx.erDe(c)), eng, consist: ctx.consistShow(c), comentarios: com, publico: ctx.publicoShow(c), why: ctx.whyOf(r) };
  });
}
