/**
 * DEFESA DO SQUAD (feedback rodada 2, F2.3 — set/2026; proposta da D8, ainda sem resposta
 * do cliente: membros ACTUAIS do squad, incluindo externos e notas; texto na tela com copiar
 * e PDF; leitor = equipa da marca).
 *
 * Duas vias, a mesma estrutura — objetivo do briefing → por que este conjunto (redes,
 * território, alcance, E.R.) → um parágrafo curto por creator (aprovados e em estudo
 * primeiro; descartados ficam de fora) → riscos e lacunas de dados:
 *  - `promptDefesa(ctx)` para o Haiku (/api/squad-defesa);
 *  - `defesaModelo(ctx)`: texto determinístico, sem custo, usado sempre que o modelo falha
 *    (créditos, limite, tempo). É o gerador de «Gerar defesa do casting»
 *    (components/CampaignActions.js) trazido para o servidor e aplicado ao squad — mesmo
 *    tom e o mesmo fecho: a lista organiza a evidência, não substitui quem conhece a marca.
 *
 * Números: E.R. é SEMPRE engajamentos ÷ views (lib/engagement.js); dado ausente é "sem
 * dado", nunca 0. Os por rede vêm de creators.metricas_rede (90 dias, lib/metricas-rede.js);
 * sem eles, do último snapshot da conta (o mesmo da tabela do squad).
 */
import { fetchPageIds } from "./page-data.js";
import { fetchSquadSnapshot } from "./squad-data.js";
import { CURADORIA_LABEL } from "./squad-curadoria.js";
import { TAG_LABEL } from "./casting.js";
import { redeMaisForte, nomeRede, objetivoDe } from "./rede-forte.js";

const ORDEM_CURADORIA = { aprovada: 0, em_estudo: 1, sugerida: 2 };

const fmt = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const x = Number(n);
  if (x >= 1e6) return `${(Math.round(x / 1e5) / 10).toLocaleString("pt-BR")}M`;
  if (x >= 1e3) return `${Math.round(x / 1e3).toLocaleString("pt-BR")}k`;
  return Math.round(x).toLocaleString("pt-BR");
};
const pct = (n) => n == null || !Number.isFinite(Number(n)) ? null : `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (v) => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const handleTxt = (h) => h ? `@${String(h).replace(/^@+/, "")}` : "";

// Castings antigos guardam réguas internas no porquê ("Authority Anchor — …", "aderência ao
// brief 65", "Marca 72/100"): o cliente lê-as como score, por isso saem (mesma limpeza do
// whyOf de app/(app)/campanha/[id]/page.js).
const PREFIXOS = ["Authority Anchor", "Authority Lead", "Rising Bet", "Discovery Bet", "Hidden Opportunity", "Efficiency Play", "Safe Scale", "Scale Support", "Out of Territory", "Not Recommended"];
export function limparPorque(txt) {
  let t = String(txt || "").trim();
  if (!t) return null;
  for (const p of PREFIXOS) { if (t.startsWith(p + " — ")) { t = t.slice(p.length + 3); break; } }
  t = t.replace(/\s*·\s*aderência ao brief \d+/g, "")
    .replace(/\s*·\s*aderência (feminino|masculino) (\d+)\/100/g, (_, g) => ` · audiência ${g === "feminino" ? "feminina" : "masculina"} confirmada`)
    .replace(/([A-Za-zÀ-ÿ'’ ]+?) \d+\/100 \((recomendada|watchlist|fit baixo|⚠ não recomendada)\)/g, (_, marca, vd) => `${marca.trim()}: ${vd === "watchlist" ? "a validar" : vd}`)
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/**
 * Junta tudo o que a defesa precisa. `podeVerBriefing(camp)` decide se o texto do briefing
 * entra (briefings são individuais; squads são da equipa): sem acesso, fica só o nome.
 */
export async function carregarContextoDefesa(db, listId, { podeVerBriefing = () => true } = {}) {
  const snap = await fetchSquadSnapshot(db, listId);
  if (!snap) return null;
  const cIds = snap.items.map((it) => it.creator_id).filter(Boolean);
  const campId = snap.list.campaign_id;
  const [extras, campRes, porques] = await Promise.all([
    fetchPageIds((ids) => db.from("creators").select("id, person_key, metricas_rede, eng_index:kol_screen->metricas->eng_index, indice_faixa:conversa->volume->indice_faixa").in("id", ids).order("id"), cIds).catch(() => []),
    campId ? Promise.resolve(db.from("campaigns").select("id, name, briefing, parsed, user_id, shared_with").eq("id", campId).maybeSingle()).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    campId ? fetchPageIds((ids) => db.from("campaign_creators").select("creator_id, rationale, match_score").eq("campaign_id", campId).in("creator_id", ids).order("id"), cIds).catch(() => []) : Promise.resolve([]),
  ]);
  const camp = campRes?.data ?? null;
  const visivel = camp && podeVerBriefing(camp);
  const extraBy = new Map(extras.map((r) => [r.id, r]));
  const porqueBy = new Map(porques.map((r) => [r.creator_id, r.rationale]));
  // a aderência vive no casting do briefing: list_creators.match_score fica vazio nos squads
  // criados pelo sync (21/09/2026: 0 de 148 no squad de cabelo cacheado)
  const aderenciaBy = new Map(porques.map((r) => [r.creator_id, r.match_score]));
  const parsed = visivel ? camp.parsed || {} : {};

  const membros = snap.items.map((it) => {
    const perfil = it.creator || it.prospect || {};
    const ex = extraBy.get(it.creator_id) || {};
    const mr = ex.metricas_rede || null;
    const total = mr?.total || null;
    const views = num(total?.views_media) ?? num(it.metrics?.avg_views);
    const er = num(total?.eng_rate) ?? num(it.metrics?.eng_rate);
    const redes = Object.entries(mr?.redes || {}).map(([rede, r]) => ({
      rede: nomeRede(rede), views_media: num(r.views_media), eng_rate: num(r.eng_rate),
      comentarios_media: num(r.comentarios_media), n_pecas: r.n_pecas ?? null,
    }));
    const forte = mr ? redeMaisForte(mr, { objetivo: objetivoDe(parsed), engIndex: ex.eng_index, indiceFaixa: ex.indice_faixa }) : [];
    return {
      nome: perfil.name || handleTxt(perfil.handle) || "Perfil sem nome",
      handle: handleTxt(perfil.handle),
      rede: perfil.platform ? nomeRede(perfil.platform) : null,
      externo: !it.creator_id,
      em_analise: !it.creator_id || ["aguardando", "processando"].includes(it.status),
      tag: TAG_LABEL[it.tag] || null,
      curadoria: it.curadoria || "sugerida",
      pessoa: ex.person_key || it.creator_id || it.prospect_id || it.id,
      aderencia: num(it.match_score) ?? num(aderenciaBy.get(it.creator_id)),
      seguidores: num(perfil.followers),
      views_media: views,
      eng_rate: er,
      engajamento: views != null && er != null ? views * er / 100 : null,
      comentarios_media: num(it.media_comentarios),
      territorio: it.territorio || null,
      redes,
      rede_forte: forte[0]?.frase || null,
      porque: limparPorque(porqueBy.get(it.creator_id)),
      notas: it.notas || null,
    };
  });

  return {
    squad: snap.list.name,
    briefing: camp ? {
      nome: camp.name,
      texto: visivel ? String(camp.briefing || "").slice(0, 2500) : null,
      objetivo: parsed.objetivo || null,
      marca: parsed.marca_alvo && parsed.marca_alvo !== "nenhuma" ? parsed.marca_alvo : null,
      produto: parsed.produto || parsed.produto_marca || null,
      territorio: parsed.territorio || parsed.nicho || null,
      publico: parsed.publico_alvo || null,
      plataforma: parsed.plataforma || null,
      keywords: (parsed.keywords || []).slice(0, 8),
    } : null,
    projecao: snap.projection,
    membros,
  };
}

/** Membros que entram na defesa, na ordem da defesa: aprovados, em estudo, sugeridos — e,
 *  dentro de cada estado, pela aderência ao briefing (list_creators.match_score), como na
 *  lista de Creators; seguidores só desempatam. Por seguidores, o topo de um squad de
 *  cabelo cacheado abria com uma creator de lifestyle de 32M. */
export function membrosDaDefesa(membros = []) {
  const ordenados = membros.filter((m) => m.curadoria !== "descartada")
    .sort((a, b) => (ORDEM_CURADORIA[a.curadoria] ?? 3) - (ORDEM_CURADORIA[b.curadoria] ?? 3)
      || (b.aderencia ?? -1) - (a.aderencia ?? -1) || (b.seguidores ?? -1) - (a.seguidores ?? -1));
  // Uma pessoa, um parágrafo: as contas ligadas (person_key) entram no squad como membros
  // separados, mas o metricas_rede de cada uma já é o da pessoa (todas as redes) — fica a
  // conta mais bem colocada, as outras não repetem o mesmo texto.
  const vistas = new Set();
  return ordenados.filter((m) => { if (!m.pessoa) return true; if (vistas.has(m.pessoa)) return false; vistas.add(m.pessoa); return true; });
}

function contar(arr, f) {
  const out = {};
  for (const x of arr) { const k = f(x); if (k) out[k] = (out[k] || 0) + 1; }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
const CURADORIA_PLURAL = { aprovada: "aprovadas", em_estudo: "em estudo", sugerida: "sugeridas", descartada: "descartadas" };
const CURADORIA_SING = { aprovada: "aprovada", em_estudo: "em estudo", sugerida: "sugerida", descartada: "descartada" };
const frase = (t) => { const x = String(t || "").trim().replace(/\.+$/, ""); return x ? `${x}.` : ""; };
const listaPt = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
const plural = (n, um, varios) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

function paragrafoCreator(m) {
  const cab = [m.handle && m.handle !== m.nome ? m.handle : null, m.rede, m.tag, CURADORIA_LABEL[m.curadoria]].filter(Boolean).join(" · ");
  const nums = [
    m.seguidores != null ? `${fmt(m.seguidores)} seguidores` : null,
    m.views_media != null ? `${fmt(m.views_media)} views médias` : null,
    m.eng_rate != null ? `E.R. ${pct(m.eng_rate)}` : null,
    m.comentarios_media != null ? `${fmt(m.comentarios_media)} comentários por peça` : null,
  ].filter(Boolean);
  const partes = [];
  if (m.em_analise && !nums.slice(1).length) partes.push("Perfil incluído pela equipa, ainda em análise: os números chegam quando a leitura terminar.");
  else if (nums.length) partes.push(`${nums.join(", ")}.`);
  if (m.territorio) partes.push(`Território: ${m.territorio}.`);
  const porRede = m.redes.filter((r) => r.views_media != null).map((r) => `${r.rede} ${fmt(r.views_media)} views${r.eng_rate != null ? ` / E.R. ${pct(r.eng_rate)}` : ""}`);
  if (porRede.length > 1) partes.push(`Por rede (90 dias): ${porRede.join("; ")}.`);
  if (m.rede_forte) partes.push(frase(m.rede_forte));
  if (m.porque) partes.push(frase(m.porque));
  if (m.notas) partes.push(`Nota da equipa: “${m.notas.replace(/\s+/g, " ").trim()}”`);
  return `• ${m.nome}${cab ? ` (${cab})` : ""} — ${partes.join(" ")}`;
}

// Um squad de briefing traz ~150 nomes: um parágrafo para cada um dava ~40 mil caracteres,
// ilegível numa defesa. Os primeiros MAX_MODELO (aprovados e em estudo vêm à frente) têm
// parágrafo; os restantes ficam numa linha só com o nome — o mesmo corte do prompt da IA.
const MAX_MODELO = 25;
function paragrafosCreators(lista) {
  const topo = lista.slice(0, MAX_MODELO).map(paragrafoCreator).join("\n");
  const resto = lista.slice(MAX_MODELO);
  return resto.length ? `${topo}\nTambém no squad (${resto.length}): ${resto.map((m) => m.nome).join(", ")}.` : topo;
}

/** Texto determinístico da defesa — sem LLM, sem custo. */
export function defesaModelo(ctx) {
  const b = ctx.briefing;
  const todos = ctx.membros || [];
  const lista = membrosDaDefesa(todos);
  const descartados = todos.filter((m) => m.curadoria === "descartada").length;
  const p = ctx.projecao || {};

  const objetivo = [];
  if (b) {
    objetivo.push(`Briefing: ${b.nome}.`);
    const alvo = [b.marca && `marca ${b.marca}`, b.produto && `produto ${b.produto}`].filter(Boolean);
    if (alvo.length) objetivo.push(`Para ${listaPt(alvo)}.`);
    if (b.objetivo) objetivo.push(`Objetivo: ${b.objetivo}.`);
    if (b.territorio) objetivo.push(`Território de conteúdo: ${String(b.territorio).trim().replace(/\.+$/, "")}${b.keywords?.length ? ` (${b.keywords.slice(0, 5).join(", ")})` : ""}.`);
    if (b.publico) objetivo.push(frase(`Público: ${b.publico}`));
    if (!b.objetivo && b.texto) {
      const t = b.texto.replace(/\s+/g, " ").trim();
      objetivo.push(frase(t.charAt(0).toUpperCase() + t.slice(1, 400) + (t.length > 400 ? "…" : "")));
    }
  } else {
    objetivo.push("Squad montado pela equipa, sem briefing ligado: a defesa apoia-se só nos números e nas notas dos membros.");
  }

  const redes = contar(lista, (m) => m.rede);
  const terr = contar(lista, (m) => m.territorio?.replace(/\s+\d+%$/, "").toLowerCase());
  const tags = contar(lista, (m) => m.tag);
  const cur = contar(lista, (m) => m.curadoria);
  const porque = [
    `${plural(lista.length, "creator", "creators")}${cur.length ? ` (${cur.map(([k, n]) => `${n} ${n === 1 ? CURADORIA_SING[k] : CURADORIA_PLURAL[k]}`).join(", ")})` : ""}${descartados ? `; ${plural(descartados, "descartado fica", "descartados ficam")} fora desta defesa` : ""}.`,
    redes.length ? `Redes: ${redes.map(([k, n]) => `${k} ${n}`).join(" · ")}.` : null,
    tags.length ? `Perfil do grupo: ${tags.map(([k, n]) => `${n} ${k}`).join(", ")}.` : null,
    terr.length ? `Território predominante: ${terr.slice(0, 3).map(([k, n]) => `${k} (${n})`).join(", ")}.` : null,
    p.alcance != null ? `Alcance somado: ${fmt(p.alcance)} seguidores (contas diferentes podem partilhar audiência; não é audiência única).` : null,
    p.views != null ? `Se cada creator publicar uma vez: ~${fmt(p.views)} views estimadas${p.eng != null ? ` e ~${fmt(p.eng)} interações` : ""}.` : null,
    p.er != null ? `E.R. conjunta: ${pct(p.er)} (engajamentos ÷ views, ${p.erBase} de ${p.total} com dados).` : null,
  ].filter(Boolean).join(" ");

  const riscos = [];
  const semNumeros = lista.filter((m) => m.views_media == null || m.eng_rate == null);
  const emAnalise = lista.filter((m) => m.em_analise);
  if (emAnalise.length) riscos.push(`${plural(emAnalise.length, "perfil externo ainda em análise", "perfis externos ainda em análise")}: ${emAnalise.slice(0, 6).map((m) => m.nome).join(", ")}${emAnalise.length > 6 ? "…" : ""}.`);
  if (semNumeros.length) riscos.push(`${plural(semNumeros.length, "creator sem", "creators sem")} views ou E.R. medidos — ficam fora das projeções.`);
  if (p.total && p.erBase < p.total) riscos.push(`A E.R. conjunta cobre ${p.erBase} de ${p.total} membros (os que têm views e taxa medidas no último snapshot).`);
  if (redes.length === 1 && lista.length > 2) riscos.push(`Todo o squad está no ${redes[0][0]}: não há leitura de outra rede.`);
  else if (redes.length > 1 && redes[0][1] / lista.length >= 0.8) riscos.push(`Concentração no ${redes[0][0]} (${redes[0][1]} de ${lista.length}).`);
  const sugeridos = lista.filter((m) => m.curadoria === "sugerida").length;
  if (sugeridos && sugeridos === lista.length) riscos.push("Nenhum nome foi ainda aprovado ou posto em estudo: a lista é de sugestões.");
  if (!b) riscos.push("Sem briefing ligado: não há requisitos para confirmar a aderência.");
  riscos.push("Os números são históricos (últimos 90 dias ou último snapshot) e não garantem resultados; o alcance somado não desconta audiência repetida.");

  return `DEFESA DO SQUAD — ${ctx.squad}

OBJETIVO DO BRIEFING
${objetivo.join(" ")}

POR QUE ESTE CONJUNTO
${porque || "Squad ainda sem membros com dados."}

OS CREATORS
${lista.length ? paragrafosCreators(lista) : "Nenhum membro para defender (todos descartados ou squad vazio)."}

RISCOS E LACUNAS DE DADOS
${riscos.map((r) => `• ${r}`).join("\n")}

O squad organiza a evidência — território, alcance, engajamento e as notas da equipa — para a marca decidir; não substitui a avaliação de quem conhece a marca.`;
}

/** Contexto compacto para o modelo (sem ids nem autores). */
// Até 40 creators com números (os primeiros da ordem da defesa); os restantes vão só pelo
// nome, para o texto caber na resposta sem cortar a meio.
const MAX_IA = 40;
function dadosParaIa(ctx) {
  const todos = membrosDaDefesa(ctx.membros);
  const lista = todos.slice(0, MAX_IA);
  return {
    squad: ctx.squad,
    briefing: ctx.briefing,
    big_numbers: {
      views_estimadas: ctx.projecao?.views ?? null,
      engajamento_projetado: ctx.projecao?.eng ?? null,
      er_conjunta_pct: ctx.projecao?.er != null ? Math.round(ctx.projecao.er * 100) / 100 : null,
      alcance_somado: ctx.projecao?.alcance ?? null,
      membros: ctx.projecao?.total ?? 0,
    },
    descartados_fora: (ctx.membros || []).length - membrosDaDefesa(ctx.membros).length,
    creators: lista.map((m) => ({
      nome: m.nome, handle: m.handle, rede: m.rede, tag: m.tag, status: CURADORIA_LABEL[m.curadoria],
      externo_em_analise: m.em_analise || undefined,
      seguidores: m.seguidores, views_media: m.views_media, er_pct: m.eng_rate != null ? Math.round(m.eng_rate * 100) / 100 : null,
      comentarios_por_peca: m.comentarios_media, territorio: m.territorio,
      por_rede_90d: m.redes.length > 1 ? m.redes : undefined,
      rede_mais_forte: m.rede_forte || undefined, porque_no_briefing: m.porque || undefined, nota_da_equipa: m.notas || undefined,
    })),
    outros_creators_so_nome: todos.length > MAX_IA ? todos.slice(MAX_IA).map((m) => m.nome) : undefined,
  };
}

export function promptDefesa(ctx) {
  return `Você é head de creator strategy de beleza no Brasil. Escreva, em português do Brasil, a DEFESA de um squad de creators para a equipa da marca aprovar.

Use SÓ os dados abaixo — nunca invente números, marcas, resultados ou fatos sobre os creators. Dado ausente (null) é "sem dado", nunca zero. E.R. é engajamentos ÷ views. Não mencione scores, notas numéricas internas nem "KOLLECT".

Estrutura, com estes títulos em maiúsculas e texto corrido (sem markdown, sem negrito, sem #):
DEFESA DO SQUAD — ${ctx.squad}
OBJETIVO DO BRIEFING — 2 a 3 frases (se não houver briefing, diga que o squad foi montado pela equipa).
POR QUE ESTE CONJUNTO — um parágrafo: cobertura de redes, território, alcance somado (não é audiência única), views estimadas e E.R. conjunta.
OS CREATORS — um parágrafo curto por creator, começando por "• Nome (@handle · rede · status) —", na ordem recebida (aprovados e em estudo primeiro); se houver "outros_creators_so_nome", feche a secção com uma linha que os enumera. Use os números, a rede mais forte, o porquê do briefing e a nota da equipa quando existirem.
RISCOS E LACUNAS DE DADOS — marcadores "• " curtos: perfis em análise, creators sem dados, concentração numa rede, o que falta confirmar.
Feche com uma frase: o squad organiza a evidência para a marca decidir.

DADOS:
${JSON.stringify(dadosParaIa(ctx))}`;
}
