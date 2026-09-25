// BUSCA POR TEMA — "cabelo cacheado", "pele oleosa", "rotina matinal".
//
// O que a pessoa procura raramente está no nome ou no @: está no conteúdo. O índice
// semântico (video_chunks + creator_chunks, 768d, gemini-embedding-001) já existia para o
// chat de cada creator (app/api/creator-chat); aqui corre sobre a base toda, pela RPC
// busca_tema (migração busca_tema_por_conteudo), que devolve por creator a melhor
// semelhança do seu conteúdo com o tema e quantos chunks entraram no top.
//
// Não é a match_creator_content do chat: essa filtra por limiar em cada ramo antes de
// ordenar, o que sem filter_creator é um varrimento completo dos 28 mil chunks — a frio
// passou o statement_timeout (medido 02/09/2026). A busca_tema faz ORDER BY distância
// LIMIT k por tabela, que o índice HNSW responde em milissegundos.
//
// CALIBRAÇÃO (02/09/2026, melhor chunk por creator, top-800 chunks): as semelhanças do
// gemini-embedding vivem numa faixa estreita — texto sem sentido ("xkqzv plorb") chega a
// 0,64 e um tema real curto ("pele oleosa") a 0,66, portanto o limiar 0,3 herdado do chat
// não separa nada. Embeber a consulta como "Vídeo sobre {tema}" — a forma dos chunks, que
// começam por "Creator: … Vídeo: …" — afasta os dois: sem sentido 0,69 (0 creators ≥ 0,70),
// pele oleosa 0,78 (16 ≥ 0,70), cabelo cacheado 0,79 (117), perfume masculino 0,75 (19),
// rotina de skincare para pele oleosa 0,78 (55). Daí o molde e o corte em 0,70.
//
// Só corre a pedido (Enter ou botão Buscar, tema=1 na query): custa um embedding e uma
// passagem pelo pgvector, e não é coisa para disparar por tecla. A cobertura é a do índice
// — creators sem deep-scan/embeddings não aparecem por aqui, apareçam ou não por nome.
// imports relativos: lib/busca-semantica.js (e o test-busca.mjs, fora do Next) reusam o
// embedding daqui sem o alias @/.
import { supabaseAdmin } from "./supabase.js";
import { fold } from "./text.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const EMB_MODEL = "gemini-embedding-001";

// corte na melhor semelhança por creator — ver a calibração no cabeçalho
export const TEMA_LIMIAR = 0.7;
// chunks pedidos à RPC por tabela (vídeos e perfil), não creators: um creator tem dezenas,
// e é o máximo por creator que interessa. 400 é também o ef_search fixado na RPC.
export const TEMA_CHUNKS = 400;
// a consulta é embebida na forma dos chunks ("Creator: … Vídeo: …") — ver a calibração
export const MOLDE = (q) => `Vídeo sobre ${q}`;

// Cache de processo por consulta. O scroll infinito pede a mesma consulta fatia a fatia
// (offset 48, 96…), e cada mudança de filtro repete-a: sem isto, cada uma pagava o
// embedding e a passagem pelo pgvector outra vez. Guarda a Promise para pedidos
// simultâneos partilharem a mesma chamada.
const TTL_MS = 5 * 60_000;
const _cache = new Map(); // consulta normalizada → { at, promise }

export async function embedConsulta(texto, GEMINI_KEY) {
  const r = await fetch(`${GEMINI_BASE}/v1beta/models/${EMB_MODEL}:embedContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMB_MODEL}`,
      content: { parts: [{ text: texto.slice(0, 1500) }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    }),
  }).then((x) => x.json());
  const vals = r.embedding?.values;
  if (!vals) throw new Error(`embedding falhou: ${(r.error?.message || "sem resposta").slice(0, 150)}`);
  // o mesmo espaço dos chunks: 768d normalizado
  const norm = Math.sqrt(vals.reduce((s, x) => s + x * x, 0)) || 1;
  return vals.map((x) => x / norm);
}

async function correr(q, { limiar, chunks }) {
  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) throw new Error("GEMINI_KEY em falta");
  const vec = await embedConsulta(MOLDE(q), GEMINI_KEY);
  const { data, error } = await supabaseAdmin().rpc("busca_tema", { query_embedding: vec, por_fonte: chunks });
  if (error) throw new Error(error.message);
  // a RPC já vem agregada por creator e ordenada; aqui só se aplica o corte
  const porCreator = new Map();
  for (const h of data ?? []) {
    const s = Number(h.similarity);
    if (h.creator_id && Number.isFinite(s) && s >= limiar) porCreator.set(h.creator_id, s);
  }
  return { porCreator, chunks: data?.length ?? 0 };
}

/**
 * Creators cujo conteúdo fala do tema `q`.
 * → { porCreator: Map<creator_id, semelhança 0–1>, chunks } ou { erro, porCreator: Map vazio }.
 * Nunca lança: a lista tem de continuar a responder com os acertos por nome quando o
 * Gemini falha ou a chave não está configurada — a falha vai no `erro`, para a barra dizer.
 */
export async function buscaPorTema(q, { limiar = TEMA_LIMIAR, chunks = TEMA_CHUNKS } = {}) {
  const chave = `${fold(String(q || "").trim())}|${limiar}|${chunks}`;
  if (!chave.split("|")[0]) return { porCreator: new Map(), chunks: 0 };
  const hit = _cache.get(chave);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = correr(String(q).trim(), { limiar, chunks })
    .catch((e) => { _cache.delete(chave); return { erro: String(e?.message || e).slice(0, 200), porCreator: new Map(), chunks: 0 }; });
  _cache.set(chave, { at: Date.now(), promise });
  return promise;
}
