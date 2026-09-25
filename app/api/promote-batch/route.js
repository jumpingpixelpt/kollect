import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { internalJson } from "@/lib/internal-fetch";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Promoção em lote da fila da DESCOBERTA (fonte tubular-video) — o promote-tiktok-batch só
 * drena as fontes caption-*, e a triagem de 30/07 (435 prospects de score ≥ 75 num dia)
 * não tinha condutor nenhum: era um clique por prospect.
 *
 *   GET ?minscore=75   piso de mini_score da fila
 *       &dias=1        janela de descoberta (1 = só hoje)
 *       &n=1           quantos promover NESTA chamada
 *
 * n=1 por desenho: cada promoção arrasta a cadeia de enriquecimento inteira (~3-4 min com
 * o deep-scan e a audiência) e o orçamento da função são 300s. Quem repete a chamada até ao
 * alvo é o BROWSER (components/PromoteRunner.js), pela mesma razão da cadeia de descoberta:
 * a Vercel corta auto-invocações à 5ª, e um condutor no servidor morria em silêncio.
 *
 * CLAIM no padrão do resolve-handles: 'promovendo:<epoch-ms>' antes de gastar Apify, com
 * recuperação dos presos (>20 min = a função morreu entre o claim e o resultado). O caminho
 * feliz não precisa de revert — o promote-tiktok/apify grava 'promovido' por cima; o revert
 * só corre se o status ainda for o NOSSO claim (um falha_* do promote fica intacto).
 */
const CLAIM = "promovendo:";

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
export const POST = GET;

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const minscore = Number(sp.get("minscore")) || 75;
  const dias = Math.max(1, Math.min(Number(sp.get("dias")) || 1, 90));
  const n = Math.min(Number(sp.get("n")) || 1, 2);
  const base = new URL(req.url).origin;
  const db = supabaseAdmin();
  const desde = new Date(Date.now() - (dias - 1) * 864e5).toISOString().slice(0, 10);

  // presos: claim de uma invocação que morreu — devolve à fila
  const corte = Date.now() - 20 * 60000;
  await db.from("prospects").update({ status: "novo" })
    .like("status", `${CLAIM}%`).lt("status", `${CLAIM}${corte}`)
    .then(() => {}, () => {});

  // já no radar: promover outra vez pagava o Apify em duplicado (lição do promote-tiktok-batch)
  const known = new Set(
    (await fetchAllRows(() => db.from("creators").select("handle").order("handle")))
      .map((x) => (x.handle || "").toLowerCase())
  );

  const { data: filaBruta, count } = await db.from("prospects")
    .select("tubular_id, handle, name, platform, mini_score", { count: "exact" })
    .gte("descoberto_em", desde).gte("mini_score", minscore)
    .not("handle", "is", null).eq("status", "novo")
    .in("platform", ["tiktok", "instagram"])
    .order("mini_score", { ascending: false })
    .limit(40);
  const fila = (filaBruta || []).filter((p) => !known.has(p.handle.toLowerCase()));

  // sem handle ainda por resolver — o PromoteRunner usa isto para saber se corre o
  // resolve-handles primeiro. Conta só quem AINDA TEM HIPÓTESE: a família `sem_handle%`
  // (incluindo os `sem_handle:irrecuperavel:<data>`) fica de fora, senão o runner via
  // trabalho por fazer que nunca diminui e mandava o resolve-handles correr para sempre.
  const { count: semHandle } = await db.from("prospects")
    .select("tubular_id", { count: "exact", head: true })
    .gte("descoberto_em", desde).gte("mini_score", minscore)
    .is("handle", null).not("post_url", "is", null)
    .not("status", "like", "sem_handle%").not("status", "like", "resolvendo_handle:%");

  // ?check=1 — só o estado da fila, sem claim nem promoção (a fase 1 do PromoteRunner
  // pergunta isto antes de decidir se corre o resolve-handles)
  if (sp.get("check") || !fila.length) {
    return NextResponse.json({
      ok: true, promovidos: [], fila_restante: fila.length ? (count ?? fila.length) : 0,
      sem_handle: semHandle ?? 0,
      msg: !fila.length && (semHandle ?? 0) > 0 ? "fila vazia mas há prospects sem @ — resolver handles primeiro" : (!fila.length ? "fila vazia" : null),
    });
  }

  const lote = fila.slice(0, n);
  const claim = `${CLAIM}${Date.now()}`;
  await db.from("prospects").update({ status: claim }).in("tubular_id", lote.map((p) => p.tubular_id));

  const out = [];
  const t0 = Date.now();
  for (const p of lote) {
    if (Date.now() - t0 > 250000) { // não cabe outra promoção inteira — devolve à fila
      await db.from("prospects").update({ status: "novo" }).eq("tubular_id", p.tubular_id).eq("status", claim);
      continue;
    }
    const j = await internalJson(`${base}/api/promote?tubular_id=${encodeURIComponent(p.tubular_id)}`, { nome: "promote", timeout: 240000 });
    const erro = j?.error || j?.fatal || null;
    if (erro) {
      // devolve à fila SÓ se o promote não escreveu um status próprio (falha_*, promovido…)
      await db.from("prospects").update({ status: "novo" }).eq("tubular_id", p.tubular_id).eq("status", claim);
    }
    out.push({ handle: p.handle, platform: p.platform, mini_score: p.mini_score, rota: j?.rota ?? null, classe: j?.classe ?? null, erro });
  }

  const restante = Math.max(0, (count ?? fila.length) - out.filter((o) => !o.erro).length);
  return NextResponse.json({
    ok: true,
    promovidos: out,
    fila_restante: restante,
    sem_handle: semHandle ?? 0,
    continua: restante > 0,
  });
}
