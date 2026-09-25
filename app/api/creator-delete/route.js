import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { invalidateRadarCache } from "@/lib/radar-data";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Apagar creators do radar.
 *
 *   POST { ids: [uuid, …] }        apaga
 *   POST { ids: […], dry: true }   só conta o que seria destruído, não apaga nada
 *
 * PORQUE É QUE ISTO CONTA ANTES DE APAGAR
 *
 * As dez tabelas que referenciam `creators` estão TODAS em ON DELETE CASCADE (verificado a
 * 30/07 no information_schema): snapshots, videos, video_chunks, creator_chunks, scores,
 * brand_fit, campaign_creators, list_creators, tag_targets e crm. Um DELETE aqui não apaga
 * uma linha — apaga o dossiê inteiro, e sem aviso nenhum do Postgres.
 *
 * Parte disso foi PAGO e volta a ser cobrado numa reimportação do mesmo handle: a análise
 * multimodal de cada vídeo é do Gemini, os embeddings também, o brand-scan e o screening são
 * do Claude, e a demografia de audiência é um crédito do influencers.club — o mesmo plano que
 * o post-mortem de jul/2026 apanhou a ser queimado. E há uma peça que nem pagando se
 * recupera: o histórico de snapshots é medido dia a dia desde que o creator entrou, e uma
 * reimportação só reconstrói o que a Tubular ainda tiver.
 *
 * Daí o `dry`, no mesmo hábito do ?dry=1 do audience-refresh e do discover-tubular: mostrar o
 * custo antes de o pagar, aqui aplicado ao custo de DESTRUIR em vez do de gastar. A UI mostra
 * estes números na confirmação, para a decisão ser tomada com eles à vista e não a partir de
 * um "tem certeza?" genérico.
 *
 * O PROSPECT DE ORIGEM VOLTA A SER DECIDÍVEL
 *
 * 1.750 prospects estão em `status = 'promovido'`. Apagar o creator sem lhes tocar deixava-os
 * a afirmar uma promoção para uma linha que já não existe — e sem forma de distinguir "já foi
 * avaliado e recusado" de "está no radar". Passam a `removido`, que não é `novo` nem casa com
 * os padrões que as rotas de promoção em lote drenam (`vids*`, `handle*`, `falha*`, `erro*`),
 * portanto ficam fora da fila sem serem re-promovidos por acidente — e o motivo fica gravado.
 */

// tabela → como se chama isto para quem está a decidir
const TABELAS = [
  ["snapshots", "medições de histórico"],
  ["videos", "vídeos"],
  ["video_chunks", "trechos de vídeo indexados"],
  ["creator_chunks", "trechos de perfil indexados"],
  ["scores", "cálculos de Radar Score"],
  ["brand_fit", "fits de marca"],
  ["campaign_creators", "presenças em casting"],
  ["list_creators", "presenças em listas"],
  ["tag_targets", "tags aplicadas"],
  ["crm", "registos de contacto"],
];

export async function POST(req) {
  // apagar o dossiê inteiro (cascata em 10 tabelas, dados pagos) é acto de Gestão: só admin
  // (pentest set/2026: "non-admin users can delete arbitrary creators")
  const bloqueio = await exigirSessao(req, { admin: true });
  if (bloqueio) return bloqueio;
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "ids obrigatório" }, { status: 200 });
  // tecto de lote: não é performance, é travão de estrago. Um clique não deve poder esvaziar
  // a base, e 200 é mais do que qualquer triagem humana de uma sentada.
  if (ids.length > 200) return NextResponse.json({ error: `${ids.length} de uma vez é demasiado — o tecto é 200 por chamada` }, { status: 200 });

  const db = supabaseAdmin();
  const { data: alvos, error: ae } = await db.from("creators")
    .select("id, name, handle, platform, tubular_id").in("id", ids);
  if (ae) return NextResponse.json({ error: ae.message }, { status: 200 });
  if (!alvos?.length) return NextResponse.json({ error: "nenhum creator encontrado com esses ids" }, { status: 200 });

  const conta = async (tabela, afinar) => {
    let q = db.from(tabela).select("*", { count: "exact", head: true }).in("creator_id", ids);
    if (afinar) q = afinar(q);
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };

  const inventario = {};
  for (const [t, rotulo] of TABELAS) inventario[t] = { rotulo, linhas: await conta(t) };
  // o subconjunto que custou dinheiro ao Gemini, destacado à parte do total de vídeos
  inventario.videos.analisados = await conta("videos", (q) => q.not("content_score", "is", null));

  const tids = alvos.map((c) => c.tubular_id).filter(Boolean);

  if (body.dry) {
    return NextResponse.json({
      dry: true,
      creators: alvos.map((c) => ({ id: c.id, nome: c.name, handle: c.handle, platform: c.platform })),
      inventario,
      prospects_a_reabrir: tids.length,
      irrecuperavel: "O histórico de medições não se recupera com uma reimportação — só se reconstrói o que a Tubular ainda tiver.",
      pago: "Análise de vídeo, embeddings, brand-scan, screening e audiência foram pagos e voltam a ser cobrados se o handle for reimportado.",
    });
  }

  // Prospects ANTES do delete: depois do CASCADE já não há tubular_id de onde os encontrar.
  let prospects = 0;
  if (tids.length) {
    const { data, error } = await db.from("prospects")
      .update({ status: "removido" }).in("tubular_id", tids).select("tubular_id");
    if (!error) prospects = data?.length ?? 0;
  }

  const { error: de } = await db.from("creators").delete().in("id", ids);
  if (de) return NextResponse.json({ error: de.message, prospects_marcados: prospects }, { status: 200 });

  // o cache de processo do radar ainda tem os apagados — limpa a instância local; o cliente
  // completa o serviço pedindo a lista com ?fresh=1 (ver CreatorsInfinite.recarregar)
  invalidateRadarCache();

  return NextResponse.json({
    ok: true,
    apagados: alvos.length,
    creators: alvos.map((c) => `@${c.handle}`),
    em_cascata: inventario,
    prospects_marcados: prospects,
  });
}
