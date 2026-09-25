// EXPANSÃO SEMÂNTICA DO CASTING (feedback rodada 2, F1.2 — set/2026).
//
// O pré-filtro por palavras-chave (lib/casting-prefiltro.js) só vê o que está escrito nos
// nichos, marcas e nome de cada creator. Um briefing de "queda associada a GLP-1" não
// casa com nicho nenhum — mas há creators a falar de Ozempic e queda nos vídeos. O
// briefing-parse devolve `temas[]` ({rotulo, termos_pt, termos_en, situacoes}); aqui cada
// tema é embebido com o gemini-embedding-001 (o mesmo espaço do índice, lib/busca-tema.js)
// e consultado na RPC busca_tema. Os creators encontrados JUNTAM-SE ao pool por palavras
// ANTES do campaignEval — passam pelas mesmas regras (negativos, disaster, sem Score KOL,
// fora de território com fit baixo). Não há peso novo: a semântica só decide quem é
// avaliado, e o tema que casou vai escrito no porquê.
//
// LIMIAR (calibrado a 21/09/2026 com o test-busca.mjs sobre os seis temas do cliente —
// ver o relatório do F1.2): a busca da barra (TEMA_LIMIAR 0,70) quer precisão, porque o
// que devolve é a lista que se vê. Aqui o que sai ainda passa pelo campaignEval, portanto
// o custo de um falso positivo é baixo e o de um falso negativo (um creator certo que
// nunca é avaliado) é alto: queremos recall. Mas as consultas daqui são longas ("Vídeo
// sobre rótulo: termo, termo…"), e isso sobe o chão de ruído: três temas de controlo fora
// da base no mesmo molde deram melhor semelhança 0,650 (texto sem sentido), 0,702 (receita
// de bolo) e 0,715 (carros e mecânica) — a 0,68 os controlos já traziam 4 e 12 creators, a
// 0,70 um cada, a 0,72 nenhum. Com 0,72 os seis temas trazem 15 (hormonais) a 162 (baby
// hair/cachos) creators; a 0,65 passariam de 300–500, com os controlos a trazer 15–161.
// Por isso 0,72 (o corte mais baixo sem ruído nos controlos) para o casting, e 0,70 no
// "Mais nomes", onde quem pede já aceita alargar.
//
// COBERTURA: só alcança creators com índice (video_chunks: ~1,6 mil com deep-scan;
// creator_chunks: ~3,9 mil) — os restantes continuam a entrar só pelas palavras.
//
// Nunca lança: sem GEMINI_KEY, ou com o Gemini/RPC em baixo, devolve o Map vazio e o
// `erro`, e o casting segue só com o pool por palavras (o route regista nos logs).
import { embedConsulta, MOLDE, TEMA_CHUNKS } from "./busca-tema.js";
import { normalizarTemas } from "./temas.js";
// as funções puras dos temas vivem em lib/temas.js (a confirmação, no browser, também as usa)
export { normalizarTemas, termosDosTemas, keywordsComTemas } from "./temas.js";

// corte na melhor semelhança por creator, por tema — ver a calibração no cabeçalho
export const LIMIAR_EXPANSAO = 0.72;
// "Mais nomes" (F1.3): um degrau abaixo, para alargar
export const LIMIAR_MAIS = 0.7;
// temas consultados por casting (cada um custa um embedding e uma passagem pelo pgvector)
export const MAX_TEMAS = 8;
export const MAX_TEMAS_MAIS = 16;

/** O texto que se embebe por tema: "rótulo: termos pt, termos en" (situações entram se couberem). */
export function textoDoTema(t) {
  const termos = [...(t.termos_pt ?? []), ...(t.termos_en ?? [])];
  const sit = (t.situacoes ?? []).slice(0, 3);
  return `${t.rotulo}${termos.length ? `: ${termos.join(", ")}` : ""}${sit.length ? `. ${sit.join("; ")}` : ""}`.slice(0, 900);
}

// Cache de processo por texto do tema: reprocessar ou pedir "Mais nomes" sobre o mesmo
// briefing não volta a pagar o embedding. Guarda a Promise (pedidos simultâneos partilham).
const _emb = new Map();
const EMB_MAX = 500;
function embedTema(texto, key) {
  const hit = _emb.get(texto);
  if (hit) return hit;
  const p = embedConsulta(MOLDE(texto), key).catch((e) => { _emb.delete(texto); throw e; });
  if (_emb.size >= EMB_MAX) _emb.delete(_emb.keys().next().value);
  _emb.set(texto, p);
  return p;
}

/**
 * Creators cujo conteúdo fala de algum dos temas.
 * → { porCreator: Map<creator_id, {sim, rotulo}>, porTema: [{rotulo, n, erro?}], erro? }
 * `db` é um cliente supabase (service role); `geminiKey` por defeito process.env.GEMINI_KEY.
 */
export async function buscaSemantica(temas, { db, geminiKey = process.env.GEMINI_KEY, limiar = LIMIAR_EXPANSAO, max = MAX_TEMAS, chunks = TEMA_CHUNKS } = {}) {
  const porCreator = new Map();
  const ts = normalizarTemas(temas).slice(0, max);
  if (!ts.length) return { porCreator, porTema: [] };
  if (!geminiKey) return { porCreator, porTema: [], erro: "GEMINI_KEY em falta" };
  if (!db) return { porCreator, porTema: [], erro: "sem cliente da base" };

  const porTema = await Promise.all(ts.map(async (t) => {
    try {
      const vec = await embedTema(textoDoTema(t), geminiKey);
      const { data, error } = await db.rpc("busca_tema", { query_embedding: vec, por_fonte: chunks });
      if (error) throw new Error(error.message);
      const hits = [];
      for (const h of data ?? []) {
        const s = Number(h.similarity);
        if (h.creator_id && Number.isFinite(s) && s >= limiar) hits.push([h.creator_id, s]);
      }
      return { rotulo: t.rotulo, hits };
    } catch (e) {
      return { rotulo: t.rotulo, hits: [], erro: String(e?.message || e).slice(0, 200) };
    }
  }));

  // por creator fica o tema com a maior semelhança — é esse que o porquê cita
  for (const { rotulo, hits } of porTema) {
    for (const [id, sim] of hits) {
      const prev = porCreator.get(id);
      if (!prev || sim > prev.sim) porCreator.set(id, { sim, rotulo });
    }
  }
  const erros = porTema.filter((t) => t.erro);
  return {
    porCreator,
    porTema: porTema.map((t) => ({ rotulo: t.rotulo, n: t.hits.length, ...(t.erro ? { erro: t.erro } : {}) })),
    ...(erros.length === porTema.length ? { erro: erros[0].erro } : {}),
  };
}

/** "conteúdo sobre «GLP-1» (similaridade 0,71)" — o pedaço que entra no porquê do casting. */
export const fraseSemantica = (h) =>
  `conteúdo sobre «${h.rotulo}» (similaridade ${h.sim.toFixed(2).replace(".", ",")})`;
