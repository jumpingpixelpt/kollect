import { supabaseAdmin } from "@/lib/supabase";

/**
 * Orçamento do influencers.club — o vendor pago mais caro da plataforma.
 *
 * Contexto (post-mortem de jul/2026): o plano ANUAL de ~12.000 créditos foi quase todo
 * consumido em poucos meses, na convicção de que era mensal. A causa não foi um bug: foram
 * três consumidores a competir pelo mesmo pote sem ninguém a medir. A descoberta em massa
 * (ic-sweep/ic-discover) revelou 37.815 perfis — 91% dos prospects da base — e foi de longe
 * a maior linha; os shares de Instagram (ic-shares, 0,03/post) corriam na cadeia de enrich
 * de todo o creator; e a demografia de audiência (1 crédito/perfil) era disparada em toda
 * promoção. Decisão do cliente, jul/2026: o IC fica reservado ao ÚNICO dado que só ele tem
 * — a demografia de audiência. Descoberta vive no Apify, transcrição no Groq.
 *
 * Este módulo existe para que nunca mais se gaste às cegas. Duas regras:
 *
 *  1. PISO ANTES DA CHAMADA. Os guards antigos liam `credits_left` da RESPOSTA — ou seja,
 *     verificavam o saldo depois de já o terem gasto, e cada invocação queimava uma página
 *     inteira antes de abortar. O saldo aqui é lido do endpoint de saldo, que não custa
 *     créditos, ANTES de qualquer chamada paga.
 *
 *  2. FALHA FECHADA. Se o saldo não puder ser determinado, uma operação em lote é recusada.
 *     Um crédito perdido numa chamada avulsa recupera-se; um lote de 15 às cegas não.
 *
 * FORMATO DA RESPOSTA (verificado a 29/jul/2026, contra a API a sério):
 *
 *     GET /public/v1/accounts/credits/   →   {"credits_available":627.13,"credits_used":0}
 *
 * Até aqui o campo era adivinhado entre cinco candidatos, porque a chave do IC só existia no
 * Vercel e nunca se tinha visto a resposta. Nenhum dos cinco era o certo: a lista tinha
 * `available_credits`, a API diz `credits_available`. Isso não falhava de forma visível —
 * falhava da pior maneira possível, que é a silenciosa: `extrairSaldo` devolvia null, e a
 * regra 2 (falha fechada) recusava TODO o lote mesmo com o plano cheio. A demografia de
 * audiência, o único uso que sobrou do IC, nunca teria corrido.
 *
 * O saldo é decimal (627.13) — daí `Number` e não `parseInt` em todo o módulo.
 */

const BASE = "https://api-dashboard.influencers.club";
const STATE_KEY = "ic_credits";

// piso abaixo do qual nada é gasto. Sobrepõe-se por IC_CREDIT_FLOOR no ambiente.
export const PISO = Number(process.env.IC_CREDIT_FLOOR) || 50;

// Campo do saldo, verificado (ver FORMATO DA RESPOSTA). Não voltar a alargar isto para uma
// lista de palpites: o palpite errado passa despercebido, porque o efeito é o sistema
// recusar-se a gastar em silêncio. Se o IC mudar o nome, `/api/ic-debug?credits=1` mostra o
// corpo cru sem gastar créditos.
const CAMPO_SALDO = "credits_available";
const CAMPO_GASTO = "credits_used";

function raizes(j) {
  return [j, j?.result, j?.data].filter((r) => r && typeof r === "object");
}

function extrairSaldo(j) {
  for (const raiz of raizes(j)) {
    const v = Number(raiz[CAMPO_SALDO]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

// A mesma resposta traz o acumulado gasto. O post-mortem (§3.5) pedia telemetria de consumo
// e não havia nenhuma — guardá-lo aqui custa zero, porque vem de graça na chamada do saldo.
function extrairGasto(j) {
  for (const raiz of raizes(j)) {
    const v = Number(raiz[CAMPO_GASTO]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/** Grava o último saldo observado. É a semente da telemetria que o post-mortem pediu (§3.5):
 *  sem isto não há como responder "quantos créditos gastámos esta semana". */
export async function registarSaldo(saldo, origem, gasto = null) {
  if (!Number.isFinite(saldo)) return;
  try {
    const value = { saldo, origem, visto_em: new Date().toISOString() };
    if (Number.isFinite(gasto)) value.gasto_acumulado = gasto;
    await supabaseAdmin().from("sweep_state").upsert(
      { key: STATE_KEY, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  } catch { /* telemetria nunca pode derrubar a chamada que a produziu */ }
}

/**
 * Saldo actual. Custa 0 créditos.
 *
 * Devolve { saldo, auth }. Distinguir os dois modos de falha não é luxo: um 401 e um campo
 * com outro nome davam ambos `null`, e quem lia a resposta não conseguia saber se a chave
 * está morta ou se sou eu que não sei ler o corpo. Aconteceu em produção — a chave começou
 * a ser recusada e o sistema tentou na mesma a chamada paga, para trazer de volta o 401 cru
 * do vendor. Com `auth` separado, uma chave recusada trava tudo já e diz o que fazer.
 */
export async function lerSaldo() {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return { saldo: null, auth: "sem_chave" };
  try {
    // GET, não POST: é o método que o /api/ic-debug?credits=1 usa (o helper de lá resolve
    // `body ? "POST" : "GET"` e esta chamada não leva corpo), portanto é o único verificado
    // contra este endpoint. Ao contrário do resto da API do IC, que é toda POST.
    const r = await fetch(`${BASE}/public/v1/accounts/credits/`, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (r.status === 401 || r.status === 403) return { saldo: null, auth: "recusada" };
    const j = await r.json().catch(() => null);
    const saldo = extrairSaldo(j);
    if (saldo != null) await registarSaldo(saldo, "consulta", extrairGasto(j));
    return { saldo, auth: "ok" };
  } catch { return { saldo: null, auth: "indisponivel" }; }
}

/** Último saldo conhecido, quando a consulta ao vivo falha. */
export async function saldoConhecido() {
  try {
    const { data } = await supabaseAdmin().from("sweep_state").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = Number(data?.value?.saldo);
    return Number.isFinite(v) ? { saldo: v, visto_em: data.value.visto_em ?? null } : null;
  } catch { return null; }
}

/**
 * Autoriza (ou não) gastar `custo` créditos.
 *
 * `lote` distingue as duas posturas do ponto 2: um lote sem saldo determinável é recusado,
 * uma chamada avulsa passa (custa 1 crédito e o utilizador está à espera do resultado).
 */
export async function podeGastar(custo = 1, { lote = false } = {}) {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) {
    return { ok: false, saldo: null, motivo: "INFLUENCERS_CLUB_API_KEY não configurada" };
  }
  const { saldo: vivo, auth } = await lerSaldo();

  // Chave recusada é falha fechada SEMPRE, lote ou avulso. Não há saldo que salve uma chamada
  // que vai levar 401 de certeza: tentá-la só troca uma mensagem accionável pelo erro cru do
  // vendor, à frente de quem está a usar a ferramenta.
  if (auth === "recusada") {
    return {
      ok: false, saldo: null, auth,
      motivo: "influencers.club recusou a INFLUENCERS_CLUB_API_KEY (401) — chave inválida, expirada ou plano terminado. Renove a chave no painel do IC e atualize-a na Vercel. Confirme com /api/ic-debug?credits=1, que não gasta créditos.",
    };
  }

  let saldo = vivo;
  let fonte = "consulta";
  if (saldo == null) {
    const ult = await saldoConhecido();
    if (ult) { saldo = ult.saldo; fonte = `último conhecido (${ult.visto_em})`; }
  }
  if (saldo == null) {
    return lote
      ? { ok: false, saldo: null, motivo: "saldo do IC indeterminável — lote recusado por precaução" }
      : { ok: true, saldo: null, motivo: "saldo indeterminável, chamada avulsa autorizada", fonte: "desconhecido" };
  }
  if (saldo - custo < PISO) {
    return { ok: false, saldo, fonte, motivo: `piso de créditos: ${saldo} disponíveis, custo ${custo}, piso ${PISO}` };
  }
  return { ok: true, saldo, fonte };
}

/** Quantos perfis cabem no orçamento sem furar o piso. */
export function cabemNoOrcamento(saldo, pedidos) {
  if (!Number.isFinite(saldo)) return pedidos;
  return Math.max(0, Math.min(pedidos, Math.floor(saldo - PISO)));
}
