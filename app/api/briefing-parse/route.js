import { NextResponse } from "next/server";
import { CAMPOS, LIMITE_BRIEFING, termos, rotulo } from "@/lib/briefing-campos";
import { normalizarTemas } from "@/lib/temas";
import { erroPublico, ErroProvedor } from "@/lib/erro-publico";
import { alertarIa } from "@/lib/erro-rota";
import { sessionUser } from "@/lib/auth-server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Leitura estruturada do briefing — o passo ANTES do match.
 *
 * O /api/campaign lia o briefing e gerava o casting no mesmo gesto: se o texto não
 * dizia a marca, o objetivo ou o público, o modelo preenchia por inferência e ninguém
 * ficava a saber. Um casting custa ~1 min de cruzamento sobre a base inteira — caro
 * para se descobrir no fim que o pedido foi lido ao contrário.
 *
 * Esta rota só LÊ (haiku, poucos segundos) e devolve, campo a campo, o que ficou claro
 * e o que não ficou. Quem pediu confirma ou completa, e só então corre o match — com o
 * perfil já confirmado a entrar como `parsed`, o mesmo caminho determinístico que os
 * briefings fixos do cliente usam.
 *
 * POST { briefing, marca?, produto?, titulo?, negativos?, extras?, busca_id? } → { parsed, campos, resumo, faltam, busca_id }
 * `extras` são os campos que quem escreveu já estruturou à mão no formulário: valem
 * como verdade e não são reinterpretados. Os fechados (objetivo, território, plataforma)
 * voltam sempre como uma das opções de lib/briefing-campos.js — nunca como frase.
 *
 * HISTÓRICO (feedback rodada 2, bug 2 — set/2026): cada leitura fica gravada em `buscas`
 * ANTES de responder — 'lido' com o parsed, ou 'erro' com o código —, e a resposta leva o
 * `busca_id`. Quem confirma manda-o ao /api/campaign, que liga a busca ao briefing. Assim
 * uma busca que falhou (ex.: créditos da IA) ou ficou por confirmar aparece no Histórico
 * como "Não concluída", com "Retomar". Gravar é best-effort: nunca derruba a leitura.
 * Erros ao cliente só pela mensagem amigável (bug 1): o detalhe vai para os logs.
 *
 * RODADA 2, F1.1/F1.2 (set/2026 — propostas da D1): o formulário deixou de pedir título,
 * "o que não queremos" e os campos estruturados (passaram para a confirmação); pede só a
 * barra do briefing e, por baixo, **marca** e **produto**, separados e opcionais. A marca é
 * livre — saiu a lista fechada "L'Oréal Paris | Garnier | Maybelline | Elsève | nenhuma",
 * que fazia o modelo ignorar qualquer outra marca. O modelo deriva os ATRIBUTOS da marca
 * e do produto (categoria, benefício, ingrediente/tecnologia, público, dor que resolve,
 * ocasião de uso) e usa-os nas keywords e nos `temas[]` da expansão ({rotulo, termos_pt,
 * termos_en, situacoes}, 20–40 termos no total), que a confirmação mostra como chips e o
 * /api/campaign consulta na busca semântica (lib/busca-semantica.js). O título vem do
 * `nome` gerado (editável na confirmação); `titulo`, `negativos` e `extras` continuam
 * aceites para as buscas retomadas do Histórico, gravadas com o formulário antigo.
 */
const MODEL = "claude-haiku-4-5-20251001";

async function askClaude(key, prompt, maxTokens = 2000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const out = await res.json();
  if (!res.ok) throw new ErroProvedor("anthropic", res.status, out);
  const txt = out?.content?.[0]?.text ?? "";
  return JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]);
}

// Grava a leitura em `buscas` e devolve o id (ou null). Nunca lança: o histórico é um
// extra, e uma falha da base não pode custar ao cliente a leitura que já foi paga.
// Com `anterior` (a mesma busca relida: "Editar" e reler, retomar uma não concluída, tentar
// de novo depois de um erro), actualiza essa linha em vez de criar outra — desde que seja
// do mesmo utilizador e ainda não esteja confirmada.
async function gravarBusca(linha, anterior) {
  try {
    const user = await sessionUser().catch(() => null);
    const db = supabaseAdmin();
    if (anterior && user?.id && /^[0-9a-f-]{36}$/i.test(anterior)) {
      const { data: upd } = await db.from("buscas")
        .update({ ...linha, erro_codigo: linha.erro_codigo ?? null, updated_at: new Date().toISOString() })
        .eq("id", anterior).eq("user_id", user.id).neq("estado", "confirmado")
        .select("id").maybeSingle();
      if (upd?.id) return upd.id;
    }
    const { data, error } = await db.from("buscas")
      .insert({ user_id: user?.id ?? null, origem: "busca", ...linha })
      .select("id").single();
    if (error) { console.error("[briefing-parse] busca não gravada:", error.message); return null; }
    return data?.id ?? null;
  } catch (e) {
    console.error("[briefing-parse] busca não gravada:", e);
    return null;
  }
}

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY;

  let body = {};
  try { body = await req.json(); } catch { /* corpo inválido → tratado abaixo */ }
  const briefing = String(body.briefing || "").slice(0, LIMITE_BRIEFING);
  const titulo = String(body.titulo || "").trim();
  const marca = String(body.marca || "").trim();
  const produto = String(body.produto || "").trim();
  const negativosTxt = String(body.negativos || "").trim();
  const extras = body.extras && typeof body.extras === "object" ? body.extras : {};
  if (!briefing.trim()) return NextResponse.json({ error: "Escreva o pedido da busca antes de continuar.", codigo: "vazio" }, { status: 200 });
  const registo = { texto: briefing, campos: { titulo, marca, produto, negativos: negativosTxt, extras } };
  const anterior = typeof body.busca_id === "string" ? body.busca_id : null;

  // Falha da leitura (chave em falta, créditos, limite, JSON inválido do modelo): mensagem
  // amigável ao cliente, alerta interno se for a nossa conta de IA, e a busca fica no
  // histórico como 'erro' para poder ser retomada.
  const falhar = async (e) => {
    const corpo = erroPublico(e, "briefing-parse");
    const [busca_id] = await Promise.all([
      gravarBusca({ ...registo, estado: "erro", erro_codigo: corpo.codigo }, anterior),
      alertarIa(corpo, "briefing-parse"),
    ]);
    return NextResponse.json({ ...corpo, busca_id }, { status: 200 });
  };
  if (!key) return falhar(new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada"));

  // O que já veio estruturado do formulário não vai a leitura: é instrução, não texto a
  // interpretar. Entra no prompt como contexto e volta marcado como claro. Os campos
  // fechados (objetivo, território, plataforma) entram pelo rótulo, que é o que o modelo lê.
  const jaDados = CAMPOS
    .map((c) => [c, String(extras[c.k] || "").trim()])
    .filter(([, v]) => v);
  const referencia = String(extras.referencia || "").trim();

  const prompt = `Você é head de creator strategy de beleza (L'Oréal Brasil). Vai LER um pedido de busca de creators e devolver a interpretação estruturada dele. NÃO invente: o que o texto não disser fica com claro:false e valor "".

Devolva os campos de busca (para cruzar com a base) e a leitura campo a campo (para quem pediu confirmar).

Responda APENAS com JSON válido, começando IMEDIATAMENTE com {:
{"nome":"nome curto da busca (3-5 palavras)",
"territorio":"o território de conteúdo em 1 frase",
"keywords":["8-15 palavras-chave concretas, minúsculas, do jeito que aparecem em vídeos de TikTok/Instagram BR (ex.: briefing de colágeno → colágeno, firmeza, anti-idade, pele madura, rotina de skincare) — incluindo as que saem dos atributos da marca e do produto"],
"marca_alvo":"a marca do pedido, escrita como no texto (qualquer marca) — ou \"\" se o texto não disser",
"produto":"o produto do pedido, escrito como no texto — ou \"\" se o texto não disser",
"atributos":{"marca":{"categoria":"","beneficio":"","ingrediente_tecnologia":"","publico":"","dor":"","ocasiao":""},"produto":{"categoria":"","beneficio":"","ingrediente_tecnologia":"","publico":"","dor":"","ocasiao":""}},
"temas":[{"rotulo":"2-5 palavras","termos_pt":["termos como aparecem em vídeos BR"],"termos_en":["termos em inglês usados por creators BR"],"situacoes":["situações concretas em que o tema aparece num vídeo"]}],
"plataforma":"tiktok | instagram | ambas",
"publico_alvo":"género do público-alvo: feminino | masculino | ambos",
"faixa_min":NUMERO_SEGUIDORES_MIN_OU_0,
"faixa_max":NUMERO_SEGUIDORES_MAX_OU_0,
"perfil":"1 frase: que tipo de creator o pedido procura (tom, formato, autoridade)",
"objetivo":"o objetivo principal da campanha, UMA das três palavras: Awareness | Engajamento | Venda — ou \\"\\" se o texto não disser",
"territorio_lista":"o território de conteúdo, UMA das cinco palavras: Cabelo | Unha | Maquiagem | Pele | Perfume — ou \\"\\" se o texto não disser",
"negativos":["termos a EXCLUIR do casting: concorrentes citados, tipos de conta indesejados, temas proibidos. [] se não houver"],
"campos":{${CAMPOS.map((c) => `"${c.k}":{"valor":"${c.opcoes ? `uma das opções ${c.opcoes.map(([k]) => k).join(" | ")}, se o texto o disser` : c.tipo === "url" ? "o link de um perfil citado como referência, se houver" : `o que o texto diz sobre ${c.label.toLowerCase()}, nas palavras dele`}","claro":true|false}`).join(",")}},
"resumo":"uma frase que começa por \\"Entendemos que você deseja\\" e termina em \\"Está correto?\\", dizendo em linguagem de quem pediu o que se percebeu. Nomeie o que não ficou claro como não identificado — nunca preencha por suposição."}

REGRAS:
- claro:false sempre que a informação não estiver no texto. Não deduza a marca a partir do território, nem o público a partir do produto.
- atributos: o que se sabe da marca e do produto (pelo texto e pelo que a marca/produto é no mercado): categoria, benefício, ingrediente ou tecnologia, público, dor que resolve, ocasião de uso. "" no que não souber. São para MÁQUINA: alimentam keywords e temas.
- temas: 3 a 8 temas de CONTEÚDO que um creator certo para o pedido publica, derivados do pedido e dos atributos (ex.: "quebra por química" → termos_pt: tintura, descoloração, progressiva, alisamento, cabelo elástico, corte químico). Entre 20 e 40 termos no total (termos_pt + termos_en), minúsculos, concretos, sem repetir.
- keywords, territorio e perfil são para MÁQUINA cruzar com a base: sempre preenchidos, mesmo que por aproximação do território.
- campos e resumo são para PESSOA confirmar: só o que o texto realmente disser.
${titulo ? `\nTÍTULO DADO: ${titulo}` : ""}
${marca ? `\nMARCA DADA (é verdade, use como marca_alvo e como marca claro; derive os atributos dela): ${marca}` : ""}
${produto ? `\nPRODUTO DADO (é verdade, use como produto e como produto claro; derive os atributos dele): ${produto}` : ""}
${negativosTxt ? `\nO QUE NÃO QUEREMOS (é verdade, use em negativos e em restricoes claro): ${negativosTxt}` : ""}
${jaDados.length ? `\nCAMPOS JÁ ESTRUTURADOS POR QUEM PEDIU (são verdade, marque claro:true e use o valor tal como está):\n${jaDados.map(([c, v]) => `- ${c.label}: ${rotulo(c, v)}`).join("\n")}` : ""}
${referencia ? `\nPERFIL DE REFERÊNCIA (creator que serve de exemplo do que se procura — use-o para afinar território, perfil e keywords): ${referencia}` : ""}

PEDIDO:
${briefing}`;

  let out;
  // 3500: temas (20–40 termos) + atributos não cabiam nos 2000 — JSON truncado = "resposta não-JSON"
  try { out = await askClaude(key, prompt, 3500); }
  catch (e) { return falhar(e); }

  // O que veio do formulário vence a leitura — inclusive quando o modelo o ignorou.
  const campos = { ...(out.campos || {}) };
  for (const [c, v] of jaDados) campos[c.k] = { valor: v, claro: true };
  if (marca) campos.marca = { valor: marca, claro: true };
  if (produto) campos.produto = { valor: produto, claro: true };
  delete campos.produto_marca; // o modelo às vezes ainda devolve o campo antigo
  if (negativosTxt) campos.restricoes = { valor: negativosTxt, claro: true };
  for (const c of CAMPOS) campos[c.k] ||= { valor: "", claro: false };
  // Campos fechados: o valor tem de ser uma das opções — o modelo às vezes devolve a frase.
  for (const c of CAMPOS) {
    if (!c.opcoes || !campos[c.k]?.claro) continue;
    const v = String(campos[c.k].valor || "").trim().toLowerCase();
    const hit = c.opcoes.find(([k, l]) => v === k.toLowerCase() || v === l.toLowerCase() || v.includes(k.toLowerCase()));
    campos[c.k] = hit ? { valor: hit[0], claro: true } : { valor: "", claro: false };
  }
  if (!campos.tema_territorio?.claro && out.territorio_lista) {
    const hit = CAMPOS.find((c) => c.k === "tema_territorio").opcoes.find(([k]) => k.toLowerCase() === String(out.territorio_lista).trim().toLowerCase());
    if (hit) campos.tema_territorio = { valor: hit[0], claro: true };
  }

  const negativos = [...new Set([...(Array.isArray(out.negativos) ? out.negativos : []).map((n) => String(n).toLowerCase().trim()), ...termos(negativosTxt)])].filter((n) => n.length > 2);

  const parsed = {
    nome: titulo || out.nome || "Busca sem título",
    territorio: out.territorio || "",
    keywords: Array.isArray(out.keywords) ? out.keywords : [],
    marca_alvo: marca || String(out.marca_alvo || "").trim() || "nenhuma",
    produto: produto || String(out.produto || "").trim(),
    atributos: out.atributos && typeof out.atributos === "object" ? out.atributos : null,
    // temas da expansão (F1.2): chips na confirmação → busca semântica no /api/campaign
    temas: normalizarTemas(out.temas).slice(0, 8),
    plataforma: campos.plataforma?.claro ? campos.plataforma.valor : (out.plataforma || "ambas"),
    publico_alvo: out.publico_alvo || "ambos",
    faixa_min: Number(out.faixa_min) || 0,
    faixa_max: Number(out.faixa_max) || 0,
    perfil: out.perfil || "",
    objetivo: campos.objetivo?.claro ? campos.objetivo.valor : (out.objetivo || ""),
    referencia: campos.referencia?.claro ? campos.referencia.valor : "",
    negativos,
    campos,
  };

  const faltam = CAMPOS.filter((c) => !c.opcional && (!campos[c.k]?.claro || !String(campos[c.k]?.valor || "").trim())).map((c) => c.k);
  const busca_id = await gravarBusca({ ...registo, estado: "lido", parsed }, anterior);
  return NextResponse.json({ parsed, campos, faltam, resumo: out.resumo || "", busca_id });
}

// GET só para diagnóstico manual (a convenção da casa: rotas disparáveis à mão)
export async function GET() {
  return NextResponse.json({ ok: true, campos: CAMPOS.map((c) => c.k), modelo: MODEL });
}
