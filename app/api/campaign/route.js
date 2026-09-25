import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fold } from "@/lib/text";
import { scoreKolDe } from "@/lib/casting";
import { resolverReferencia, keywordsDaReferencia, partilhaSubNicho } from "@/lib/referencia";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { sessionUser, sessionRole, veCampanha, soMeus } from "@/lib/auth-server";
import { campanhaDoPedido } from "@/lib/casting-rota";
import { briefBucketDe, briefPctOf, SECONDARY_MIN, linhaRadar, preFiltro, alargarFaixa } from "@/lib/casting-prefiltro";
import {
  buscaSemantica, fraseSemantica, keywordsComTemas, normalizarTemas, termosDosTemas,
  LIMIAR_EXPANSAO, LIMIAR_MAIS, MAX_TEMAS, MAX_TEMAS_MAIS,
} from "@/lib/busca-semantica";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Erro para o cliente (feedback rodada 2, bug 1): o detalhe vai para os logs com um `ref`,
// a resposta leva a mensagem amigável. `fatal` continua a vir (com o mesmo texto) porque
// BriefingBar e CampaignActions lêem `j.error || j.fatal`.
const falha = (e, extra) => {
  const corpo = erroPublico(e, "campaign", extra);
  return NextResponse.json({ ...corpo, fatal: corpo.error }, { status: 200 });
};

// NICHE_TERMS, bucketFromText, briefPctOf e o pré-filtro por palavras-chave vivem em
// lib/casting-prefiltro.js (F1.2, set/2026) — o "Mais nomes" e o test-busca.mjs usam os mesmos.

// Sub-território de cabelo: refina o match dentro do bucket "cabelo" (fino/volume × cacheado/crespo × liso/química)
const HAIR_SUB = {
  fino_volume: ["fino", "fina", "finos", "finas", "volume", "espessura", "encorpar", "encorpad", "denso", "densidade", "rala", "ralo", "queda", "afinou", "afinad", "pós-parto", "pos-parto", "quebra", "blow-dry", "blowout", "ralinho"],
  cacheado_crespo: ["cacho", "cachos", "cachead", "crespo", "crespa", "crespos", "curly", "método curly", "metodo curly", "transição", "transicao", "afro", "fulani", "nagô", "nago", "box braid", "tranç", "tranc", "entrelace"],
  liso_quimica: ["liso", "lisa", "lisos", "progressiva", "alisament", "selagem", "botox capilar", "escova progressiva"],
};
const SUB_LABEL = { fino_volume: "fino/volume", cacheado_crespo: "cacheado/crespo", liso_quimica: "liso/química" };
function subterrOf(txt) {
  if (!txt) return null;
  const t = String(txt).toLowerCase();
  let best = null, bestN = 0;
  for (const [g, terms] of Object.entries(HAIR_SUB)) {
    let n = 0; for (const w of terms) { if (t.includes(w)) n++; }
    if (n > bestN) { bestN = n; best = g; }
  }
  return bestN >= 1 ? best : null;
}

// ─── Briefings fixos do MVP (Onda 2 do plano): perfis pré-estruturados ──────
// Não passam pelo Claude (parsedOverride) — determinísticos e reprocessáveis a
// qualquer momento. sub_territorio explícito porque a heurística de sub-nicho
// leria "queda" como fino/volume e penalizaria creators fora desse sub num
// brief que é geral (feminino) ou de outro eixo (masculino).
const BRIEFINGS_FIXOS = {
  feminino_geral: {
    briefing: "Briefing fixo do MVP — Capilar feminino geral (Elsève). Cuidado capilar feminino no Brasil: rotina e cronograma capilar, hidratação, nutrição e reconstrução, queda e quebra, crescimento saudável, brilho e força. Creators com autoridade em cabelo, rotina real documentada e prova de resultado, TikTok e Instagram. Objetivo: KOLs do território + rising stars para escalar.",
    parsed: {
      fixo: "feminino_geral",
      nome: "Capilar Feminino Geral",
      territorio: "cuidado capilar feminino: rotina, tratamento, saúde dos fios e transformação",
      keywords: ["cabelo", "capilar", "cronograma capilar", "hidratação", "nutrição capilar", "reconstrução", "queda de cabelo", "crescimento capilar", "cabelo saudável", "tratamento capilar", "finalização", "brilho", "força"],
      marca_alvo: "Elsève",
      plataforma: "ambas",
      publico_alvo: "feminino",
      sub_territorio: null,
      faixa_min: 0,
      faixa_max: 0,
      perfil: "creator com autoridade em cabelo, rotina real documentada e prova de resultado",
    },
  },
  masculino_capilar: {
    briefing: "Briefing fixo do MVP — Capilar masculino (queda e crescimento). Queda de cabelo masculina, calvície, minoxidil, crescimento capilar, saúde do couro cabeludo, barba e grooming, dermatologia masculina. Creators homens ou especialistas com público masculino, conteúdo de rotina/tratamento com prova de resultado, TikTok e Instagram.",
    parsed: {
      fixo: "masculino_capilar",
      nome: "Capilar Masculino Queda",
      territorio: "capilar masculino: queda, crescimento, couro cabeludo, barba e grooming",
      keywords: ["queda de cabelo", "queda capilar", "calvície", "minoxidil", "crescimento capilar", "couro cabeludo", "cabelo masculino", "barba", "grooming", "transplante capilar", "dermatologista", "tricologista"],
      marca_alvo: "Elsève",
      plataforma: "ambas",
      publico_alvo: "masculino",
      sub_territorio: null,
      faixa_min: 0,
      faixa_max: 0,
      perfil: "creator homem ou especialista capilar com público masculino e prova de resultado",
    },
  },
};

/**
 * Briefing Match — POST {briefing[, parsed]} :
 *  1. Claude interpreta o briefing em perfil estruturado de busca (ou usa o parsed recebido)
 *  2. cruza com o radar (dossiês completos) e com o universo de prospects
 *  3. grava campanha + listas (kol | rising | funil) com score de match e justificativa
 * GET ?id=  → campanha completa | GET → lista de campanhas
 * GET ?fixo=feminino_geral|masculino_capilar → cria (ou reprocessa in-place) o briefing fixo
 * POST {mais: <campaign_id>} | GET ?mais=<campaign_id> → "Mais nomes": acrescenta nomes no
 *   fim da lista (lote seguinte) → { novos, radar, funil, lote } (F1.3, ver runMais)
 */
export async function POST(req) {
  try { return await run(req); } catch (e) { return falha(e); }
}

export async function GET(req) {
  const db = supabaseAdmin();
  const sp = new URL(req.url).searchParams;
  // modo de teste: GET ?run_briefing=texto | ?demo=1 | ?rerun=<campaign_id> (reprocessa in-place)
  const rerun = sp.get("rerun");
  if (rerun) {
    // posse (pentest set/2026, IDOR): reprocessar reescreve o casting — só quem vê o briefing
    const acesso = await campanhaDoPedido(rerun, req);
    if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });
    const { data: camp } = await db.from("campaigns").select("id, briefing, parsed").eq("id", rerun).single();
    if (!camp) return NextResponse.json({ error: "campanha não encontrada" }, { status: 200 });
    // campanha fixa: o rerun reutiliza o perfil pré-estruturado — re-interpretar o texto
    // pelo Claude perderia o sub_territorio e poderia renomear/duplicar a campanha
    const bfFixo = BRIEFINGS_FIXOS[camp.parsed?.fixo];
    // ?publico=masculino|feminino — o mesmo override que o POST de criação aceita da
    // BriefingBar. Sem isto o rerun re-interrogava o Claude e voltava sempre ao que ele lê
    // do texto: a campanha "Elsève Crescimento Capilar" (03/ago/2026) ficou com
    // publico_alvo "ambos" porque o briefing diz "70% mulher, 30% homem" — e com "ambos" o
    // multiplicador de aderência de género fica DESLIGADO, que é exactamente o contrário do
    // que o cliente pede (a dificuldade dele é achar audiência masculina). Corrigir o eixo
    // de uma campanha existente obrigava a criar outra e perder as decisões humanas.
    const publicoRerun = sp.get("publico");
    try { return await runWith(bfFixo?.briefing ?? camp.briefing, camp.id, bfFixo?.parsed ?? null, publicoRerun); } catch (e) { return falha(e); }
  }
  const maisId = sp.get("mais");
  if (maisId) { try { return await runMais(maisId); } catch (e) { return falha(e); } }
  const fixo = sp.get("fixo");
  if (fixo) {
    const bf = BRIEFINGS_FIXOS[fixo];
    if (!bf) return NextResponse.json({ error: `briefing fixo desconhecido — opções: ${Object.keys(BRIEFINGS_FIXOS).join(" | ")}` }, { status: 200 });
    // procura pelo marcador fixo no parsed; fallback por nome cobre campanhas criadas antes do marcador
    let { data: prev } = await db.from("campaigns").select("id").eq("parsed->>fixo", fixo).order("created_at", { ascending: false }).limit(1);
    if (!prev?.length) ({ data: prev } = await db.from("campaigns").select("id").eq("name", bf.parsed.nome).order("created_at", { ascending: false }).limit(1));
    try { return await runWith(bf.briefing, prev?.[0]?.id ?? null, bf.parsed); } catch (e) { return falha(e); }
  }
  const rb = sp.get("demo")
    ? "Campanha de colágeno para Elsève — foco em firmeza, anti-idade e pele madura. Mulheres 30+, Brasil. Conteúdo de rotina real de skincare e autocuidado, TikTok e Instagram. Queremos KOLs com autoridade no território e rising stars em ascensão pra escalar com CPE baixo."
    : sp.get("run_briefing");
  if (rb) {
    try { return await runWith(rb); } catch (e) { return falha(e); }
  }
  const id = sp.get("id");
  if (!id) {
    // a mesma regra da lista de briefings: os meus, os partilhados comigo, os legados; admin vê tudo
    const { user, role } = await sessionRole();
    const { data } = await soMeus(db.from("campaigns").select("id, name, created_at, status"), user?.id, role === "admin").order("created_at", { ascending: false });
    return NextResponse.json({ campaigns: data ?? [] });
  }
  // posse (pentest set/2026, IDOR): o detalhe de um briefing alheio não sai por aqui
  const acesso = await campanhaDoPedido(id, req);
  if (acesso.error) return NextResponse.json({ error: acesso.error }, { status: 200 });
  const [{ data: camp }, { data: rows }] = await Promise.all([
    db.from("campaigns").select("*").eq("id", id).single(),
    db.from("campaign_creators").select("*").eq("campaign_id", id).order("match_score", { ascending: false }),
  ]);
  return NextResponse.json({ campaign: camp, rows: rows ?? [] });
}

async function askClaude(key, prompt, maxTokens = 4000, model = "claude-haiku-4-5-20251001") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const out = await res.json();
  if (!res.ok) throw new ErroProvedor("anthropic", res.status, out);
  const txt = out.content[0].text;
  return JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]);
}

// ─── "Mais nomes" (feedback rodada 2, F1.3 — proposta da D3) ─────────────────
// Alarga um briefing já gerado, por ordem: (1) mais temas (os do parse + os que o modelo
// acrescentar, se houver créditos, + as keywords que nenhum tema cobre), limiar semântico
// um degrau abaixo (LIMIAR_MAIS) e faixa de seguidores ±1 faixa; (2) prospects da base de
// descoberta que casam por nome, @ ou termo de descoberta, "a analisar". Os nomes novos
// entram com `lote` n (campaign_creators.lote) — no fim da lista, sem reordenar o que já
// foi visto — e passam pelo mesmo campaignEval e pelos mesmos cortes do casting original.
// TODO (passo 3 da D3): se ainda faltar, descoberta na Tubular pelos termos do briefing
// (creator.search v4, lib/tubular.js) — só com a quota acima do piso (ver D17). Fica de fora
// por agora: custa unidades e o video.search está bloqueado até 01/10.
const MAIS_RADAR = 30; // creators do radar acrescentados por clique
const MAIS_FUNIL = 20; // prospects acrescentados por clique
// creators da busca semântica garantidos além do top-150 por fit (ver extraSem em runWith)
const SEM_EXTRA = 30;

// Marca escrita à mão → nome canónico da tabela `brands` (comparação dobrada, sem
// pontuação). Não é da tabela → volta como veio. Nunca lança.
async function marcaCanonica(db, marca) {
  const m = String(marca || "").trim();
  if (!m || m.toLowerCase() === "nenhuma") return m || marca;
  const chave = (x) => fold(x).replace(/[^a-z0-9]/g, "");
  try {
    const { data } = await db.from("brands").select("name");
    return (data ?? []).find((b) => chave(b.name) === chave(m))?.name ?? m;
  } catch { return m; }
}

// Passo 2: prospects (ainda não creators) que casam por nome dobrado, @ ou termo com que a
// descoberta os trouxe — com a faixa já alargada. Devolve a mesma forma do buscarFunil.
async function buscarFunilMais(db, parsed, jaP) {
  const termos = [...new Set((parsed.keywords ?? []).map((k) => fold(String(k)).replace(/[%,()*]/g, "").trim()).filter((k) => k.length >= 4))].slice(0, 40);
  if (!termos.length) return [{ data: [] }, { data: [] }];
  const ors = termos.flatMap((k) => [`name_norm.ilike.%${k}%`, `handle.ilike.%${k.replace(/\s+/g, "")}%`, `termo.ilike.%${k}%`]).join(",");
  let q = db.from("prospects").select("tubular_id, name, handle, termo, followers, growth_30, eng_rate, uploads_30, mini_score, rising_star")
    .neq("status", "promovido").or(ors);
  if (parsed.faixa_min) q = q.gte("followers", parsed.faixa_min);
  if (parsed.faixa_max) q = q.lte("followers", parsed.faixa_max);
  const { data, error } = await q.order("mini_score", { ascending: false, nullsFirst: false }).limit(200);
  if (error) { console.error("[campaign] mais nomes — prospects:", error.message); return [{ data: [] }, { data: [] }]; }
  const lista = (data ?? []).filter((p) => !jaP.has(p.tubular_id)).map((p) => {
    const hay = fold(`${p.name || ""} ${p.handle || ""} ${p.termo || ""}`);
    return { ...p, casou: termos.find((k) => hay.includes(k) || hay.includes(k.replace(/\s+/g, ""))) || null };
  });
  return [{ data: lista }, { data: [] }];
}

// Mais temas pelo modelo — só se houver chave e créditos; qualquer falha devolve [] e o
// "Mais nomes" segue com os temas que já tem (nunca bloqueia por causa da IA).
async function temasExtra(key, parsed, briefing) {
  if (!key) return [];
  const ja = normalizarTemas(parsed.temas).map((t) => t.rotulo);
  const prompt = `Você é head de creator strategy de beleza no Brasil. Um briefing de busca de creators encontrou poucos nomes. Proponha de 3 a 5 TEMAS NOVOS, relacionados mas mais amplos ou vizinhos, para alargar a busca pelo conteúdo dos vídeos. Não repita os temas que já existem.

Responda APENAS com JSON válido: {"temas":[{"rotulo":"2-5 palavras","termos_pt":["3-6 termos como aparecem em vídeos BR"],"termos_en":["0-3 termos"],"situacoes":["0-2 situações concretas"]}]}

TEMAS QUE JÁ EXISTEM: ${ja.join("; ") || "nenhum"}
PALAVRAS-CHAVE: ${(parsed.keywords ?? []).slice(0, 25).join(", ")}
MARCA: ${parsed.marca_alvo || "—"} · PRODUTO: ${parsed.produto || "—"}
BRIEFING:
${String(briefing || "").slice(0, 2000)}`;
  try {
    const out = await Promise.race([
      askClaude(key, prompt, 1200),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout temas extra")), 20_000)),
    ]);
    return normalizarTemas(out?.temas).filter((t) => !ja.some((r) => r.toLowerCase() === t.rotulo.toLowerCase()));
  } catch (e) {
    console.error("[campaign] mais nomes — temas extra indisponíveis:", String(e?.message || e).slice(0, 200));
    return [];
  }
}

async function runMais(campaignId) {
  const id = String(campaignId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Briefing inválido.", codigo: "invalido" }, { status: 200 });
  const db = supabaseAdmin();
  const { data: camp } = await db.from("campaigns").select("id, briefing, parsed, user_id, shared_with").eq("id", id).maybeSingle();
  if (!camp) return NextResponse.json({ error: "Briefing não encontrado.", codigo: "invalido" }, { status: 200 });
  // quem vê o briefing pode pedir mais nomes (é o mesmo que acrescentar à mão). Sem sessão
  // só se chega aqui com o bearer do CRON_SECRET (middleware) — chamada interna.
  const { user, role } = await sessionRole();
  if (user && !veCampanha(camp, user.id, role === "admin")) {
    return NextResponse.json({ error: "Este briefing não está partilhado consigo.", codigo: "sem_acesso" }, { status: 200 });
  }
  const base = BRIEFINGS_FIXOS[camp.parsed?.fixo]?.parsed ?? camp.parsed;
  if (!base || !String(camp.briefing || "").trim()) return NextResponse.json({ error: "Este briefing não tem leitura gravada para alargar.", codigo: "invalido" }, { status: 200 });

  const { data: ja, error: jaErr } = await db.from("campaign_creators").select("creator_id, prospect_id, lote").eq("campaign_id", id).range(0, 4999);
  if (jaErr) throw new Error(`campaign_creators: ${jaErr.message}`);
  const jaC = new Set((ja ?? []).map((r) => r.creator_id).filter(Boolean));
  const jaP = new Set((ja ?? []).map((r) => r.prospect_id).filter(Boolean));
  const lote = Math.max(0, ...(ja ?? []).map((r) => Number(r.lote) || 0)) + 1;

  // (1) mais temas: os do parse + os do modelo (se houver créditos) + keywords sem tema
  const temas = normalizarTemas(base.temas);
  const extra = await temasExtra(process.env.ANTHROPIC_API_KEY, base, camp.briefing);
  const cobertos = new Set(termosDosTemas([...temas, ...extra]));
  const kwTemas = (base.keywords ?? []).map((k) => String(k).trim()).filter((k) => k.length > 3 && !cobertos.has(k.toLowerCase())).slice(0, 8).map((k) => ({ rotulo: k }));
  const temasMais = normalizarTemas([...temas, ...extra, ...kwTemas]).slice(0, MAX_TEMAS_MAIS);
  // faixa de seguidores ±1 faixa (só o funil de prospects usa a faixa)
  const faixa = alargarFaixa(base.faixa_min, base.faixa_max);
  const parsed = { ...base, temas: [...temas, ...extra], faixa_min: faixa.min, faixa_max: faixa.max };
  return runWith(camp.briefing, camp.id, parsed, null, null, { mais: { lote, jaC, jaP }, temasMais });
}

async function run(req) {
  const body = await req.json();
  if (body?.mais) return runMais(body.mais);
  const { briefing, parsed, publico, busca_id } = body;
  // Dono do briefing: quem o pediu. Sem sessão (cron, auto-chamada com bearer) fica NULL,
  // o regime legado — partilhado, porque não há a quem atribuir.
  const { user, role } = await sessionRole();
  const res = await runWith(briefing, null, parsed, publico, user?.id ?? null);
  // Histórico de buscas (bug 2): a linha de `buscas` gravada na leitura passa a
  // "confirmado" e liga-se ao briefing criado. Melhor esforço — nunca falha o pedido.
  if (busca_id && /^[0-9a-f-]{36}$/i.test(String(busca_id))) {
    try {
      const j = await res.clone().json();
      // só a busca do próprio (ou admin) se liga ao briefing — um busca_id alheio não pode ser
      // "confirmado" por terceiros (pentest set/2026, IDOR)
      const { data: b } = await supabaseAdmin().from("buscas").select("user_id").eq("id", busca_id).maybeSingle();
      const minha = !!b && (role === "admin" || (user?.id && b.user_id === user.id));
      if (j?.id && minha) {
        const { error } = await supabaseAdmin().from("buscas")
          .update({ estado: "confirmado", campaign_id: j.id, updated_at: new Date().toISOString() })
          .eq("id", busca_id);
        if (error) console.error("[campaign] buscas:", error.message);
      }
    } catch (e) { console.error("[campaign] buscas:", e); }
  }
  return res;
}

// opts.mais (F1.3 "Mais nomes"): { lote, jaC:Set<creator_id>, jaP:Set<prospect_id> } — alarga
// a busca de uma campanha existente e só ACRESCENTA linhas (lote n, no fim da lista).
async function runWith(briefing, existingId = null, parsedOverride = null, publicoOverride = null, userId = null, opts = {}) {
  const mais = opts.mais || null;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key && !parsedOverride) return falha(new Error("ANTHROPIC_API_KEY não configurada"));
  if (!briefing?.trim()) return NextResponse.json({ error: "briefing vazio" }, { status: 200 });
  const db = supabaseAdmin();

  // ─── 1. interpretar o briefing (ou perfil pré-estruturado: briefings fixos / testes) ───
  const parsedBase = parsedOverride || await askClaude(key, `Você é head de creator strategy de beleza (L'Oréal Brasil). Interprete o briefing de campanha abaixo e devolva um perfil estruturado de busca de creators. Expanda o território em palavras-chave concretas do jeito que aparecem em vídeos de TikTok/Instagram BR (ex.: briefing de colágeno → "colágeno, firmeza, anti-idade, pele madura, skincare, rotina de skincare, elasticidade").

Responda APENAS com JSON válido, começando IMEDIATAMENTE com {:
{"nome":"nome curto da campanha (3-5 palavras)",
"territorio":"o território de conteúdo em 1 frase",
"keywords":["8-15 palavras-chave concretas, minúsculas"],
"marca_alvo":"marca DPGP mais próxima do briefing: L'Oréal Paris | Garnier | Maybelline | Elsève | nenhuma",
"plataforma":"tiktok | instagram | ambas",
"publico_alvo":"género do público-alvo do briefing: feminino | masculino | ambos",
"faixa_min":NUMERO_SEGUIDORES_MIN_OU_0,
"faixa_max":NUMERO_SEGUIDORES_MAX_OU_0,
"perfil":"1 frase: que tipo de creator a campanha pede (tom, formato, autoridade)",
"objetivo":"o que a campanha quer alcançar em 1 frase (lançamento, always-on, prova de resultado, awareness…), ou \"\" se o briefing não disser",
"negativos":["termos a EXCLUIR do casting: concorrentes citados, tipos de conta indesejados (salão, loja, revenda), temas proibidos. [] se o briefing não disser"]}

BRIEFING:
${briefing.slice(0, 4000)}`, 1500);

  // Público-alvo escolhido na UI VENCE a leitura do Claude. O briefing do cliente (§4) diz
  // que a ferramenta trabalha dois briefings — um geral feminino e um masculino, porque há
  // dificuldade histórica de achar creators homens no nicho. Quem cola o texto sabe qual
  // eixo está a abrir; deixar isso à inferência de um parágrafo é frágil, e o género é
  // justamente o que separa os dois castings (ver o multiplicador de aderência abaixo).
  // null/"auto" mantém o que o Claude leu — briefings de outros clientes não regridem.
  // Objeto novo, nunca mutação: parsedOverride pode ser o BRIEFINGS_FIXOS (constante do módulo).
  let parsed = (publicoOverride === "feminino" || publicoOverride === "masculino")
    ? { ...parsedBase, publico_alvo: publicoOverride }
    : parsedBase;

  // ─── temas da expansão (feedback rodada 2, F1.2) ───
  // Os termos dos temas (briefing-parse → chips da confirmação) juntam-se às keywords: o
  // pré-filtro por palavras e o funil também ganham com eles. A consulta semântica sai já,
  // em paralelo com a casting_base (não depende dela). Idempotente: a confirmação já faz a
  // mesma união, e o dedup não repete termos.
  const temas = normalizarTemas(parsed.temas);
  if (temas.length) parsed = { ...parsed, temas, keywords: keywordsComTemas(parsed.keywords, temas) };
  const temasBusca = mais ? opts.temasMais ?? temas : temas;
  const semPromise = temasBusca.length
    ? buscaSemantica(temasBusca, { db, limiar: mais ? LIMIAR_MAIS : LIMIAR_EXPANSAO, max: mais ? MAX_TEMAS_MAIS : MAX_TEMAS })
    : Promise.resolve(null);
  // Marca livre (F1.1): o campo aceita qualquer marca. Se for uma das da tabela `brands`
  // escrita de outra forma ("Elseve", "loreal paris"), passa ao nome canónico — é por ele
  // que a casting_base encontra o brand_fit. Fora da tabela continua a ser só contexto.
  parsed = { ...parsed, marca_alvo: await marcaCanonica(db, parsed.marca_alvo) };

  const briefBucket = briefBucketDe(parsed, briefing);
  // sub_territorio explícito no parsed (briefings fixos) vence a heurística — null = brief sem sub-nicho
  const briefSub = parsed.sub_territorio !== undefined ? parsed.sub_territorio : subterrOf([(parsed.keywords ?? []).join(" "), parsed.territorio, parsed.nome, briefing].filter(Boolean).join(" "));

  // ─── 2. montar candidatas ────────────────────────────────────────────────
  // Uma ida à base (RPC casting_base, supabase/migrations/202609210002_casting_base.sql):
  // todos os creators, mas só com os campos que o casting lê, a ÚLTIMA nota de cada um e o
  // brand_fit da marca pedida. Antes eram três fetchAll paginados — creators com os JSONs
  // inteiros (~47 MB), a história toda de `scores` (~50k linhas) e o brand_fit inteiro — e
  // só a leitura levava ~10 s por confirmação (medido a 21/09/2026, ver
  // docs/desempenho-rodada2.md). O universo é o mesmo: o pré-filtro e o campaignEval abaixo
  // não mudaram (regras aprovadas pelo cliente). Um único valor json não sofre o corte de
  // 1000 linhas do PostgREST, por isso não há paginação.
  // O funil (prospects) só depende das keywords e da faixa: sai já, em paralelo.
  const buscarFunil = (kwsF) => {
    // contra name_norm (dobrado) — no nome estilizado do TikTok a keyword nunca batia
    const ors = kwsF.map((k) => `name_norm.ilike.%${fold(k).replace(/[%,()]/g, "")}%`).join(",");
    let pq = db.from("prospects").select("tubular_id, name, followers, growth_30, eng_rate, uploads_30, mini_score, rising_star").neq("status", "promovido");
    if (parsed.faixa_min) pq = pq.gte("followers", parsed.faixa_min);
    if (parsed.faixa_max) pq = pq.lte("followers", parsed.faixa_max);
    return Promise.all([
      ors ? pq.or(ors).order("mini_score", { ascending: false, nullsFirst: false }).limit(100) : Promise.resolve({ data: [] }),
      db.from("prospects").select("tubular_id, name, followers, growth_30, eng_rate, uploads_30, mini_score, rising_star").neq("status", "promovido").order("mini_score", { ascending: false, nullsFirst: false }).limit(80),
    ]);
  };
  const kwsFunil = (parsed.keywords ?? []).slice(0, 15);
  const funilPromise = mais ? buscarFunilMais(db, parsed, mais.jaP) : buscarFunil(kwsFunil);
  funilPromise.catch(() => {}); // sem unhandled rejection se a casting_base falhar primeiro
  const { data: base, error: baseErr } = await db.rpc("casting_base", { p_marca: parsed.marca_alvo || null });
  if (baseErr || !Array.isArray(base)) throw new Error(`casting_base: ${baseErr?.message || "resposta inválida"}`);
  const creators = base;
  // ─── perfil de referência (feedback do cliente, set/2026, ponto 3) ───
  // Na base: o território e os sub-nichos dele entram como palavras-chave, e quem partilha
  // sub-nicho leva um empurrão pequeno no fit. Fora da base: fica registado para o casting
  // dizer que não está no radar. lib/referencia.js.
  const ref = resolverReferencia(parsed.referencia, creators);
  if (ref) {
    parsed = { ...parsed, referencia_creator: ref, keywords: [...new Set([...(parsed.keywords ?? []), ...keywordsDaReferencia(ref)])] };
  }
  // fit_marca = brand_fit da marca_alvo (a casting_base já o traz só dessa marca).
  const fitMarcaBy = {}; for (const c of creators) if (c.fit_marca != null) fitMarcaBy[c.id] = Number(c.fit_marca);
  const byHandle = {}; for (const c of creators ?? []) byHandle[c.handle] = c.id;

  // pré-filtro por palavras-chave (lib/casting-prefiltro.js — as regras de sempre)
  const radar = (creators ?? []).map((c) => linhaRadar(c, parsed.marca_alvo));
  const { radarMatch: poolKw, excluidos, excluido, kwsLow } = preFiltro(radar, parsed, briefBucket);

  // ─── expansão semântica (F1.2): quem fala dos temas nos vídeos entra no pool ───
  // Só acrescenta quem ainda não está — e respeita "o que não queremos". Daqui para a
  // frente passa pelo MESMO campaignEval e pelos mesmos cortes que o resto do pool.
  // Gemini/RPC em baixo → segue só com as palavras (fica nos logs).
  const sem = await semPromise.catch((e) => ({ erro: String(e?.message || e), porCreator: new Map() }));
  if (sem?.erro) console.error("[campaign] busca semântica indisponível — só palavras-chave:", sem.erro);
  const semBy = sem?.porCreator ?? new Map();
  const noPoolKw = new Set(poolKw.map((r) => byHandle[r.handle]));
  const poolSem = semBy.size
    ? radar.filter((r) => semBy.has(r.id) && !noPoolKw.has(r.id) && !excluido(r)).map((r) => ({ ...r, _sem: true }))
    : [];
  const radarMatch = [...poolKw, ...poolSem];

  // ─── camada dinâmica por briefing: campaign_fit_score (determinístico) + campaign_role ───
  const cById = {}; for (const c of creators ?? []) cById[c.id] = c;
  const poolEngArr = radarMatch.map((r) => Number(r.eng_index)).filter((x) => x > 0).sort((a, b) => a - b);
  const poolMedianEng = poolEngArr.length ? poolEngArr[Math.floor(poolEngArr.length / 2)] : 1;
  const ROLE_LABEL = { authority_anchor: "Authority Lead", rising_bet: "Discovery Bet", hidden_opportunity: "Efficiency Play", safe_scale: "Scale Support", out_of_territory: "Out of Territory", not_recommended: "Not Recommended" };
  function campaignEval(c) {
    const ks = c.kol_screen || {}; const m = ks.metricas || {}; const bh = c.brand_history || {}; const aud = c.audience || {};
    const crSub = subterrOf(`${(bh.sub_nichos ?? []).join(" ")} ${(bh.nichos ?? []).map((n) => n.nicho).join(" ")}`);
    const subConflict = !!(briefBucket && m.niche_bucket === briefBucket && briefSub && crSub && briefSub !== crSub);
    const hay = `${(bh.nichos ?? []).map((n) => n.nicho).join(" ")} ${m.niche_bucket || ""} ${c.niche || ""}`.toLowerCase();
    let hits = 0; for (const k of kwsLow) { if (hay.includes(k) || k.split(/[ /]/).some((w) => w.length > 3 && hay.includes(w))) hits++; }
    const kwScore = kwsLow.length ? Math.min(hits / Math.min(kwsLow.length, 5), 1) : 0;
    const density = (Number(m.niche_density) || 0) / 100;
    const secPct = briefBucket ? briefPctOf(bh.nichos, briefBucket) : 0; // % no território via nicho secundário
    let territoryMatch;
    if (briefBucket) {
      if (m.niche_bucket === briefBucket)
        territoryMatch = Math.round(100 * (0.6 + 0.4 * density) * (0.7 + 0.3 * kwScore));
      else if (secPct >= SECONDARY_MIN)
        territoryMatch = Math.round(Math.min(secPct * 3, 75) * (0.7 + 0.3 * kwScore)); // território secundário: proporcional ao % no nicho
      else
        territoryMatch = Math.round(22 * kwScore);
    } else {
      territoryMatch = Math.round(100 * kwScore * (0.6 + 0.4 * density));
    }
    // Proxy OBJETIVO de território — o brand_fit subjetivo (tabela brand_fit, escrita pelo
    // Claude no /api/pipeline/brand-fit) foi removido do score de propósito, para o ranking
    // não depender de um julgamento de marca. O que sobrou mede aderência ao TERRITÓRIO do
    // brief, não encaixe com a marca — e por isso NÃO se chama "fit <marca>" no texto do
    // cartão (ver whyText). O rótulo antigo dizia "fit Elsève 72" ao lado de uma ficha que
    // dizia "Elsève 20 · Not recommended": o mesmo creator, dois números com o mesmo nome.
    // Caso que o expôs (03/ago/2026): @protesecapilar_vinniciusfranca — 90% do conteúdo em
    // "Cabelo", mas o cabelo dele é PRÓTESE (substituição), o oposto de um produto de
    // crescimento. O bucket `cabelo` não distingue prótese de tratamento; o brand_fit sim.
    const territorioBrief = Math.round(territoryMatch * 0.8);
    const engR = (Number(m.eng_index) || 0) / (poolMedianEng || 1);
    const engScore = Math.round(Math.min(engR / 1.5, 1) * 100);
    const consist = m.consistency_pct ?? 50;
    const audience = aud.credibilidade_pct != null ? Math.round(aud.credibilidade_pct) : 55;
    const reach = m.reach_eff != null ? Math.round(Math.min(Number(m.reach_eff) / 1.5, 1) * 100) : 40;
    // autoridade de mercado: tamanho + percentil no nicho + marcas que ja contratam (pesa mais que densidade pura)
    const followersN = Number(c.followers) || 0;
    const sizeBand = followersN >= 1000000 ? 100 : followersN >= 500000 ? 88 : followersN >= 300000 ? 76 : followersN >= 100000 ? 60 : followersN >= 50000 ? 45 : followersN >= 20000 ? 32 : 20;
    const pctScore = m.follower_pct != null ? Math.round(Number(m.follower_pct) * 100) : 50;
    const pt = Number(m.pt_adj) || 0; // Participação no Nicho Ajustado (SHINE) — share de engajamento no nicho
    const authority = Math.min(Math.round(0.45 * sizeBand + 0.25 * pctScore + 0.30 * Math.min(pt, 100)), 100);
    const fitBase = Math.round(0.45 * authority + 0.28 * territoryMatch + 0.13 * engScore + 0.09 * consist + 0.05 * reach); // 100% objetivo
    const bet = (ks.comercial ?? []).find((x) => x.id === "bets")?.resultado === "red flag";
    // disaster check (feedback do cliente, set/2026, ponto 10): risco alto não entra na lista
    const disaster = ks.disaster?.nivel === "alto";
    const fpct = m.follower_pct, re = Number(m.reach_eff) || 0;
    let role;
    if (bet || disaster) role = "not_recommended";
    else if (territoryMatch < 40) role = "out_of_territory";
    else if (territoryMatch >= 70 && authority >= 70 && consist >= 60 && engR >= 1.2) role = "authority_anchor";
    else if (territoryMatch >= 60 && engR >= 1.5 && re >= 1.0 && (fpct == null || fpct < 0.75)) role = "hidden_opportunity";
    else if (territoryMatch >= 60 && engR >= 1.3 && (fpct == null || fpct < 0.75)) role = "rising_bet";
    else if (territoryMatch >= 50 && consist >= 70) role = "safe_scale";
    else role = fitBase >= 50 ? "safe_scale" : "out_of_territory";
    // sub-nicho conflitante (ex.: cacheado/crespo num brief de fino/volume) penaliza o fit, mas mantém o tipo/seção
    let fit = subConflict ? Math.round(fitBase * 0.65) : fitBase;
    // ─── aderência de GÉNERO ao público-alvo do briefing (Onda 2) ───
    // multiplicador neutro em aderência 50 (×1.0); pleno ×1.15, nulo ×0.85. Usa SÓ o
    // componente de género — a nota composta de aderência do kol_score mistura faixa
    // etária e Brasil (~100 em toda a base BR), o que neutralizaria o targeting e chegaria
    // a premiar audiência do género errado. Semântica de género espelha lib/kolscore.js:
    // masculino prefere aud.generos[MALE], senão 100−mulheres_pct; pleno a 80%.
    // Sem público definido ou sem demografia, o fit não muda (nunca penalizar falta de dado).
    const publicoAlvo = parsed.publico_alvo === "masculino" ? "masculino" : parsed.publico_alvo === "feminino" ? "feminino" : null;
    let ade = null;
    if (publicoAlvo) {
      let gPct = null;
      if (publicoAlvo === "masculino") {
        const male = (Array.isArray(aud.generos) ? aud.generos : []).find((g) => g && g.code === "MALE");
        if (male?.weight != null) gPct = Math.round(Number(male.weight) * 1000) / 10;
        else if (aud.mulheres_pct != null) gPct = 100 - Number(aud.mulheres_pct);
      } else if (aud.mulheres_pct != null) gPct = Number(aud.mulheres_pct);
      if (gPct != null) {
        ade = Math.round(Math.min(Math.max(gPct, 0) / 80, 1) * 100);
        fit = Math.min(Math.round(fit * (0.85 + 0.3 * (ade / 100))), 100);
      }
    }

    // ─── ADEQUAÇÃO À MARCA-ALVO (04/ago/2026, decisão do Rui) ───
    //
    // O fit era 100% objetivo (a0104f8) e o brand_fit ficou de fora do ranking. A
    // consequência apareceu no primeiro casting que o cliente viu: no top-16 da campanha
    // 7bc6e9ad havia SEIS creators em "Not recommended" na Elsève — @protesecapilar_
    // vinniciusfranca com 20, @omilenorocha com 5 — todos com território alto porque fazem
    // "cabelo". Território não é marca: prótese capilar é 90% cabelo e é o oposto de um
    // produto de crescimento. A regra do cliente é simples — o topo do casting tem de
    // fazer fit com a marca.
    //
    // MULTIPLICADOR, não peso no fitBase: o brand_fit é um julgamento do Claude sobre
    // persona, e dar-lhe uma fatia do score devolvia-lhe o poder de MONTAR o ranking, que
    // é justamente o que a0104f8 tirou. Como multiplicador ele só pode DESPROMOVER quem
    // está claramente fora e dar um empurrão pequeno a quem está claramente dentro; a
    // ordem entre pares continua a ser decidida pelos sinais objetivos.
    //
    // Os cortes são os mesmos que a ficha mostra (components/BrandFitMatrix.js), para o
    // ecrã e o ranking não poderem discordar outra vez.
    //
    // SEM DADO NÃO PENALIZA — mesma regra do género acima. Mas atenção: isso torna a
    // COBERTURA parte do ranking. Com 82 dos 150 sem brand_fit, penalizar só quem tem
    // medição faria flutuar para o topo quem nunca foi medido. Correr o
    // /api/pipeline/brand-fit sobre o casting é pré-requisito, não higiene.
    // fit_marca já vem só da marca_alvo (casting_base); sem marca_alvo a RPC não devolve nenhum
    const marcaFit = parsed.marca_alvo && fitMarcaBy[c.id] != null ? Math.round(fitMarcaBy[c.id]) : null;
    if (marcaFit != null) {
      const mult = marcaFit >= 70 ? 1.05 : marcaFit >= 50 ? 1.0 : marcaFit >= 35 ? 0.85 : 0.6;
      fit = Math.min(Math.round(fit * mult), 100);
      // "Not recommended" na marca-alvo não pode liderar autoridade — o papel de topo do
      // casting é o rosto da campanha, e um rosto que a marca recusa não é um rosto.
      if (marcaFit < 35 && role === "authority_anchor") role = "safe_scale";
    }

    // mesmo sub-nicho do perfil de referência: +5%, nunca muda o papel
    const refOk = partilhaSubNicho(bh, parsed.referencia_creator);
    if (refOk) fit = Math.min(Math.round(fit * 1.05), 100);

    return { fit, role, territoryMatch, territorioBrief, engR: Math.round(engR * 100) / 100, subConflict, crSub, ade, publicoAlvo, marcaFit, refOk };
  }

  // prospects: pré-filtro barato por keyword no nome + rising_star + faixa. A consulta já
  // foi lançada em paralelo com a casting_base (buscarFunil, acima); só se repete se o
  // perfil de referência mudou as 15 primeiras keywords.
  const kws = (parsed.keywords ?? []).slice(0, 15);
  const [{ data: pKw }, { data: pTop }] = mais || JSON.stringify(kws) === JSON.stringify(kwsFunil)
    ? await funilPromise
    : await buscarFunil(kws);
  const seen = new Set();
  const funil = [...(pKw ?? []), ...(pTop ?? [])].filter((p) => !seen.has(p.tubular_id) && seen.add(p.tubular_id)).slice(0, 70);

  // ─── 3 + 4. selecionar (determinístico) + papel + fit + gravar ───
  let camp;
  let preservadas = [];
  if (mais) {
    // "Mais nomes": nada é apagado nem reescrito — só entram linhas novas, no lote seguinte
    camp = { id: existingId };
  } else if (existingId) {
    await db.from("campaigns").update({ name: parsed.nome ?? "Campanha", parsed }).eq("id", existingId);
    // O reprocessamento NÃO apaga trabalho humano: adições manuais (kind="manual") e
    // tudo o que saiu de "sugerida" (aprovada / descartada / em_estudo) mantêm-se, e
    // levam só uma atualização de fit/papel/justificativa mais abaixo. Apenas as
    // sugestões automáticas ainda por decidir são reconstruídas.
    const { data: manter } = await db.from("campaign_creators")
      .select("id, creator_id, prospect_id, status, kind")
      .eq("campaign_id", existingId)
      .or("kind.eq.manual,status.neq.sugerida,lote.gt.0");
    preservadas = manter ?? [];
    // as linhas do "Mais nomes" (lote > 0) também ficam: foram pedidas por alguém, e
    // apagá-las fazia a lista encolher a cada reprocessamento
    await db.from("campaign_creators").delete()
      .eq("campaign_id", existingId).eq("status", "sugerida").neq("kind", "manual").eq("lote", 0);
    camp = { id: existingId };
  } else {
    const { data, error: ce } = await db.from("campaigns").insert({ name: parsed.nome ?? "Campanha", briefing, parsed, user_id: userId }).select("id").single();
    if (ce) return falha(new Error(`campaigns insert: ${ce.message}`));
    camp = data;
  }

  const fmtK = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n || 0));
  // "Por que entra" é evidência, não nota (feedback do cliente, set/2026, pontos 10 e 14):
  // o que a creator publica, quanto engaja face ao pool, com que regularidade, para quem.
  // Sem "aderência ao brief 65" nem "Elsève 72/100" — números de régua interna que o
  // cliente lê como score. O veredicto da marca fica em palavras.
  const whyText = (c, ev) => {
    const m = c.kol_screen?.metricas || {};
    const terr = c.brand_history?.nichos?.[0]?.nicho ? String(c.brand_history.nichos[0].nicho).split(/[&/|]/)[0].trim() : (c.niche || "beleza");
    const bits = [];
    if (m.niche_density != null) bits.push(`${Math.round(m.niche_density)}% do conteúdo em ${terr}`);
    if (ev.engR) bits.push(`engaja ${ev.engR}× o pool`);
    if (m.consistency_pct != null) bits.push(`publica com ${Math.round(m.consistency_pct)}% de consistência`);
    if (ev.ade != null && ev.publicoAlvo) {
      const aud = c.audience || {};
      const pct = ev.publicoAlvo === "feminino" ? aud.mulheres_pct : (aud.mulheres_pct != null ? 100 - Number(aud.mulheres_pct) : null);
      bits.push(pct != null ? `audiência ${Math.round(pct)}% ${ev.publicoAlvo === "feminino" ? "feminina" : "masculina"}` : `audiência ${ev.publicoAlvo === "feminino" ? "feminina" : "masculina"} confirmada`);
    }
    // o veredicto da marca vai no texto com as MESMAS palavras da Brand Fit Matrix da ficha
    if (ev.marcaFit != null && parsed.marca_alvo) {
      const vd = ev.marcaFit >= 70 ? "recomendada" : ev.marcaFit >= 50 ? "a validar" : ev.marcaFit >= 35 ? "fit baixo" : "⚠ não recomendada";
      bits.push(`${parsed.marca_alvo}: ${vd}`);
    }
    if (ev.refOk && parsed.referencia_creator?.handle) bits.push(`mesmo sub-nicho de @${parsed.referencia_creator.handle} (perfil de referência)`);
    // o tema da expansão semântica que casou com o conteúdo (F1.2) — por último, antes do ponto
    const sh = semBy.get(c.id);
    if (sh) bits.push(fraseSemantica(sh));
    let txt = `${ROLE_LABEL[ev.role]} — ${bits.join(" · ")}.`;
    if (c.kol_screen?.disaster?.nivel === "medio") txt += ` ⚠ Disaster check a rever: ${(c.kol_screen.disaster.sinais || []).join(", ").toLowerCase()}.`;
    if (ev.subConflict) txt += ` ⚠ Sub-nicho ${SUB_LABEL[ev.crSub] || ev.crSub} fora do foco do brief (${SUB_LABEL[briefSub] || briefSub}) — validar aderência.`;
    return txt;
  };

  // linhas que sobreviveram ao reprocessamento, indexadas para não duplicar nem perder a decisão
  const keepByCreator = new Map(preservadas.filter((r) => r.creator_id).map((r) => [r.creator_id, r]));
  const keepByProspect = new Map(preservadas.filter((r) => r.prospect_id).map((r) => [r.prospect_id, r]));
  const refresh = []; // {id, patch} — atualiza os números sem tocar no status

  const rows = [];
  const aprovados = radarMatch
    .map((r) => { const id = r._sem ? r.id : byHandle[r.handle]; return id && cById[id] ? { id, ev: campaignEval(cById[id]), c: cById[id] } : null; })
    .filter(Boolean)
    // "Mais nomes": só quem ainda não está na campanha (em nenhum estado)
    .filter((x) => !mais || !mais.jaC.has(x.id))
    // Sem Score KOL não entra no casting (decisão do Rui, 02/ago/2026): o cartão mostrava "—"
    // no lugar da nota — score em falta significa enriquecimento a meio ou reprovação nos
    // cortes, e nenhum dos dois é cara que se mostre ao cliente. Com o kol-score na cadeia do
    // all-in (transcribe-casting) o estado "sem score" é transitório; quem reprova nos cortes
    // fica de fora por mérito. Adições manuais e decisões humanas não passam por aqui —
    // o reprocessamento preserva-as (ver `preservadas`).
    .filter((x) => scoreKolDe(x.c) != null)
    .filter((x) => x.ev.role !== "out_of_territory" || x.ev.fit >= 45)
    .sort((a, b) => b.ev.fit - a.ev.fit);
  const topo = aprovados.slice(0, mais ? MAIS_RADAR : 150);
  // Vaga garantida para quem a busca semântica encontrou (F1.2): num território grande
  // (cabelo: ~3 mil casam por palavras) o top-150 por fit enche-se de autoridades genéricas
  // do nicho, e o creator que fala MESMO do tema do briefing (GLP-1, alopecia de tração)
  // ficava fora por ter menos alcance. Não mexe em pesos nem na ordem: quem passou nos
  // mesmos cortes acima e casou com um tema entra no fim, até SEM_EXTRA, pela semelhança.
  const noTopo = new Set(topo.map((x) => x.id));
  const extraSem = aprovados
    .filter((x) => !noTopo.has(x.id) && semBy.has(x.id))
    .sort((a, b) => semBy.get(b.id).sim - semBy.get(a.id).sim)
    .slice(0, mais ? 10 : SEM_EXTRA);
  const evaluated = [...topo, ...extraSem];
  const vistosC = new Set();
  for (const { id, ev, c } of evaluated) {
    if (vistosC.has(id)) continue; vistosC.add(id);
    const keep = keepByCreator.get(id);
    if (keep) { refresh.push({ id: keep.id, patch: { campaign_role: ev.role, match_score: ev.fit, rationale: whyText(c, ev) } }); continue; }
    rows.push({ campaign_id: camp.id, creator_id: id, kind: ev.role === "authority_anchor" ? "kol" : "rising", campaign_role: ev.role, match_score: ev.fit, rationale: whyText(c, ev), ...(mais ? { lote: mais.lote } : {}) });
  }
  const vistosP = new Set();
  for (const f of funil.slice(0, mais ? MAIS_FUNIL : 40)) {
    if (vistosP.has(f.tubular_id)) continue; vistosP.add(f.tubular_id);
    if (mais?.jaP.has(f.tubular_id)) continue;
    const fit = Math.round(Math.min(Number(f.mini_score) || 50, 100));
    const why = `Do funil — ${fmtK(Number(f.followers))} seguidores${f.growth_30 != null ? ` · +${Math.round(f.growth_30)}% growth` : ""}${f.eng_rate != null ? ` · ${f.eng_rate}% eng` : ""}.`;
    if (keepByProspect.has(f.tubular_id)) { refresh.push({ id: keepByProspect.get(f.tubular_id).id, patch: { match_score: fit, rationale: why } }); continue; }
    rows.push({ campaign_id: camp.id, prospect_id: f.tubular_id, kind: "funil", campaign_role: "funil", match_score: fit, rationale: mais && f.casou ? `${why.slice(0, -1)} · casa com «${f.casou}».` : why, ...(mais ? { lote: mais.lote } : {}) });
  }
  let insertErr = null;
  if (rows.length) {
    const { error } = await db.from("campaign_creators").insert(rows);
    insertErr = error?.message ?? null;
  }
  // Linhas preservadas: um UPDATE em lote (RPC casting_refresh) em vez de um por linha, em
  // série. Só muda papel/fit/justificativa — o status (a decisão humana) nunca é tocado.
  if (refresh.length) {
    const { error } = await db.rpc("casting_refresh", {
      p_campaign_id: camp.id, p_rows: refresh.map((r) => ({ id: r.id, ...r.patch })),
    });
    if (error) insertErr = insertErr || `atualização: ${error.message}`.slice(0, 160);
  }

  // Cada briefing gera a sua squad list (feedback do cliente, set/2026, ponto 10.2): a
  // lista vinculada nasce com os nomes do radar que entraram no casting e continua a
  // receber os que o reprocessamento trouxer. O que a equipa tira da lista à mão não volta
  // — sync_squad_items preserva essas exclusões; só uma inclusão manual pode desfazê-las.
  let listaId = null;
  try {
    const idsCasting = [...vistosC].filter((cid) => {
      const ev = evaluated.find((x) => x.id === cid)?.ev;
      return ev && ev.role !== "out_of_territory" && ev.role !== "not_recommended";
    });
    const { data: lista, error: buscaListaError } = await db.from("lists").select("id").eq("campaign_id", camp.id).order("created_at").limit(1).maybeSingle();
    if (buscaListaError) throw new Error("Não foi possível carregar o squad da campanha.");
    if (lista?.id) {
      listaId = lista.id;
    } else {
      // Reprocessar uma campanha não transfere a autoria para quem a abriu agora.
      // Os alertas da squad vão para o criador original do briefing.
      const { data: owner, error: ownerError } = await db.from("campaigns").select("user_id").eq("id", camp.id).single();
      if (ownerError) throw new Error("Não foi possível identificar o criador do squad.");
      const { data: nova, error: listaError } = await db.from("lists").insert({ name: parsed.nome ?? "Campanha", client: "loreal", campaign_id: camp.id, user_id: owner.user_id }).select("id").single();
      if (listaError) throw new Error(listaError.message);
      listaId = nova?.id ?? null;
    }
    if (listaId && idsCasting.length) {
      // A mesma transação/lock das ações da squad evita duplicar membros quando
      // alguém os inclui enquanto o briefing está sendo reprocessado.
      const { data: added, error: syncError } = await db.rpc("sync_squad_items", {
        p_list_id: listaId, p_items: idsCasting.map((creator_id) => ({ creator_id })),
      });
      if (syncError || !Number.isInteger(added) || added < 0) {
        throw new Error("Não foi possível confirmar os membros do squad da campanha.");
      }
    }
  } catch (e) { insertErr = insertErr || `lista: ${String(e).slice(0, 120)}`; }

  const semantica = {
    temas: sem?.porTema ?? [], encontrados: semBy.size, novos_no_pool: poolSem.length,
    aprovados: aprovados.filter((x) => semBy.has(x.id)).length,
    no_casting: evaluated.filter((x) => semBy.has(x.id)).length, ...(sem?.erro ? { indisponivel: true } : {}),
  };
  if (mais) {
    if (rows.length && insertErr) return falha(new Error(`mais nomes: ${insertErr}`));
    const novosRadar = rows.filter((r) => r.creator_id).length;
    return NextResponse.json({
      novos: rows.length, radar: novosRadar, funil: rows.length - novosRadar, lote: mais.lote,
      semantica, insertErr,
    });
  }
  return NextResponse.json({
    id: camp.id, nome: parsed.nome, lista: listaId, briefBucket, radar: evaluated.length, semantica,
    funil: Math.min(funil.length, 40), gravados: rows.length,
    preservados: preservadas.length, atualizados: refresh.length, excluidos, insertErr,
  });
}
