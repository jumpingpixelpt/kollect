// Base do Creators Hub partilhada entre instâncias (22/09/2026) — tabela `radar_cache`.
//
// A montagem cara (RPC radar_base(false) + lib/radar-base.js, 2,4–3,1 s medidos daqui) corre
// fora do pedido e grava o resultado compacto (lib/radar-compacto.js) numa linha. Quem abre o
// Hub lê essa linha numa ida. Quem a mantém fresca:
//   - /api/cron/radar-cache, de 5 em 5 minutos (vercel.json);
//   - o fim da coleta diária (/api/cron/collect) e o fim de cada chamada do atualizar-lote;
//   - o próprio leitor, quando a cópia passou de FRESCO_MS (em segundo plano, com trinco);
//   - `fresh=1` (depois de apagar creators): remonta já e grava.
// Porquê uma tabela e não o Data Cache da Vercel (unstable_cache): a base compacta tem ~5 MB
// e o Data Cache recusa itens acima de 2 MB; e o cache só de processo era precisamente o que
// fazia cada instância fria pagar a montagem inteira.
import { supabaseServer as supabase } from "@/lib/supabase";
import { assembleRadarBase } from "@/lib/radar-base";
import { fetchRadarSource } from "@/lib/radar-source";
import { compactarBase, baseDoPayload, RADAR_CACHE_VERSAO } from "@/lib/radar-compacto";

const CHAVE = "hub";
// Dados mudam sobretudo uma vez por dia (coleta, atualizar-lote); o combinado é "até 10 min
// de atraso serve". O cron refresca de 5 em 5 min; passados FRESCO_MS o leitor serve a cópia
// e pede uma nova por trás; passados VELHO_MS (cron parado) já não a serve — remonta à séria.
const FRESCO_MS = 8 * 60_000;
const VELHO_MS = 60 * 60_000;
// trinco do refresh em segundo plano: uma montagem de cada vez entre todas as instâncias;
// um trinco mais velho do que isto é de uma instância que morreu a meio
const TRINCO_MS = 3 * 60_000;

// Trabalho depois da resposta. Na Vercel, o contexto do pedido expõe waitUntil (é o que
// @vercel/functions faz por baixo, sem a dependência); fora dela a promessa corre solta.
function depois(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error("[radar-cache]", String(e?.message || e).slice(0, 300)));
  try { globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil?.(p); } catch {}
  return p;
}

// Montagem a partir da base viva. Devolve a base JÁ na forma compacta — a mesma que vem da
// tabela —, para que a lista seja idêntica venha de onde vier.
export async function montarBaseHub(db = supabase) {
  const t0 = Date.now();
  const payload = compactarBase(assembleRadarBase(await fetchRadarSource(db, false), { light: false }));
  return { payload, base: baseDoPayload(payload), ms: Date.now() - t0 };
}

async function gravar(db, payload, ms) {
  const texto = JSON.stringify(payload);
  const { error } = await db.from("radar_cache").upsert({
    chave: CHAVE, versao: RADAR_CACHE_VERSAO, payload, bytes: texto.length,
    linhas: payload.rows.length, duracao_ms: ms, gerado_em: new Date().toISOString(), refrescando_em: null,
  }, { onConflict: "chave" });
  if (error) throw new Error(`radar_cache: ${error.message}`);
  return { linhas: payload.rows.length, bytes: texto.length, montagem_ms: ms };
}

// Remonta e grava — para o cron e para os fins de lote. Falhas propagam (a rota diz o erro).
export async function refrescarRadarCache(db = supabase) {
  const { payload, ms } = await montarBaseHub(db);
  return gravar(db, payload, ms);
}

// Refresh em segundo plano, só se nenhuma outra instância o tiver em curso.
async function refrescarComTrinco(db) {
  const agora = new Date();
  const limite = new Date(agora.getTime() - TRINCO_MS).toISOString();
  const { data, error } = await db.from("radar_cache")
    .update({ refrescando_em: agora.toISOString() })
    .eq("chave", CHAVE)
    .or(`refrescando_em.is.null,refrescando_em.lt.${limite}`)
    .select("chave");
  if (error || !data?.length) return; // outra instância já está nisto (ou não há linha)
  try { await refrescarRadarCache(db); }
  catch (e) {
    await db.from("radar_cache").update({ refrescando_em: null }).eq("chave", CHAVE);
    throw e;
  }
}

/**
 * A base do Hub, pelo caminho mais barato que ainda é fresco:
 *   linha com < FRESCO_MS → serve-a;
 *   < VELHO_MS            → serve-a e pede outra em segundo plano;
 *   mais velha, de outra versão do formato, em falta, ilegível, ou `fresh` → monta já a partir
 *   da base viva e grava por trás.
 */
export async function baseHub({ fresh = false } = {}) {
  const db = supabase;
  if (!fresh) {
    const { data, error } = await db.from("radar_cache")
      .select("versao, gerado_em, payload").eq("chave", CHAVE).maybeSingle();
    const base = !error && data?.versao === RADAR_CACHE_VERSAO ? baseDoPayload(data.payload) : null;
    const idade = data?.gerado_em ? Date.now() - new Date(data.gerado_em).getTime() : Infinity;
    if (base && idade < FRESCO_MS) return base;
    if (base && idade < VELHO_MS) { depois(refrescarComTrinco(db)); return base; }
    if (error) console.error("[radar-cache] leitura:", String(error.message).slice(0, 200));
  }
  const { payload, base, ms } = await montarBaseHub(db);
  depois(gravar(db, payload, ms));
  return base;
}

// Para quem acaba de mudar a base em massa (fim da coleta diária, fim de um atualizar-lote):
// pede a remontagem sem atrasar a resposta. Se a função acabar antes, o cron de 5 min cobre.
export function agendarRefrescoRadar() {
  return depois(refrescarRadarCache());
}
