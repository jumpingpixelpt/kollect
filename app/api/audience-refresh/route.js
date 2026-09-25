import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { buildAudience } from "@/lib/audience";
import { podeGastar, cabemNoOrcamento, PISO } from "@/lib/ic-budget";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE = "https://api-dashboard.influencers.club";
async function ic(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return j;
}

/**
 * Backfill de audiência (influencers.club). 1 CRÉDITO POR CREATOR.
 *
 *  GET ?id=… | ?handle=x   → só esse creator, 1 crédito. Idempotente: quem já tem audiência
 *                            sai a custo zero, o que é o que permite este passo viver na
 *                            cadeia do enriquecimento. ?force=1 compra na mesma.
 *  GET ?n=15               → processa até 15 candidatos; chamar até restantes=0
 *  GET ?so=bloqueados      → só quem tem o veredicto de KOL por dar (o crédito que muda resposta)
 *  GET ?dry=1              → só conta a fila, não gasta crédito nenhum
 *
 * O ?handle= existe porque a fila é ordenada por retorno do crédito, não por quem está a ser
 * visto. Medido a 29/jul/2026: o creator que se tinha aberto na ficha estava na posição 206 de
 * 403 — encher o painel dele pela fila custaria 206 créditos, mais de um terço do orçamento
 * utilizável, para ver um perfil. Um de cada vez custa 1.
 *
 * Nasceu como MIGRAÇÃO (v1 → v2 da audiência, quando entraram notáveis e credibilidade) e
 * por isso só olhava para `audience IS NOT NULL` — "quem já tem, atualiza". Essa migração
 * está feita. O que ficou por resolver é o oposto: `audience` só é escrito na promoção, por
 * promote-ic e promote-apify. Quem entra por promote / promote-tiktok[-batch] nasce com
 * audience nulo, e não havia rota nenhuma que o preenchesse — 398 creators já enriquecidos
 * presos nesse estado em jul/2026, 106 deles com a classe KOL por avaliar (autoridade e
 * aderência valem 30% do peso do Score KOL e ambas saem daqui). Passa a apanhar os dois casos.
 *
 * Ordem da fila é por retorno do crédito: bloqueados primeiro (desbloqueiam um veredicto),
 * depois o resto sem audiência (enriquece painel), por fim o resto da migração v2.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "audience-refresh", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

// Marcador de "IC consultado, sem audiência lá" — tira o creator da fila para não gastar o
// mesmo crédito a cada corrida. Só `{v:2}` deixava um painel de Audiência vazio e mudo, que
// se lê como falha da plataforma; `sem_dados` faz o painel dizer que foi consultado.
const semDados = (anterior) => ({
  fonte: "influencers_club", coletado_em: new Date().toISOString().slice(0, 10),
  ...(anterior || {}), v: 2, sem_dados: true,
});

/**
 * Um creator, 1 crédito. `id` manda sobre `handle` — o handle não é único (a mesma pessoa
 * pode ter conta em duas plataformas) e a ficha sabe sempre o id.
 *
 * Mesmo piso da fila: um crédito avulso continua a ser um crédito. O que muda é a postura de
 * `podeGastar` — sem `lote`, porque aqui está alguém à espera do resultado de um perfil, e não
 * uma corrida cega de 15.
 */
async function umSo(db, { handle, id, dry, force }) {
  const q = db.from("creators").select("id, handle, platform, audience").limit(2);
  const { data, error } = id ? await q.eq("id", id) : await q.eq("handle", handle);
  if (error) return NextResponse.json({ error: error.message }, { status: 200 });
  if (!data?.length) return NextResponse.json({ error: `creator não encontrado (${id || handle})` }, { status: 200 });
  // handle repetido entre plataformas: quem não tem audiência é o que interessa encher
  const c = data.find((r) => r.audience == null) || data[0];
  if (!c.handle) return NextResponse.json({ error: "creator sem handle — não há o que consultar no IC" }, { status: 200 });

  // ── IDEMPOTÊNCIA ──
  // É isto que deixa este passo entrar na cadeia do enriquecimento sem repetir o erro que o
  // post-mortem de jul/2026 apanhou: o ic-shares corria em todo o enrich e cada "↻ Atualizar
  // dados" voltava a pagar. Aqui, quem já tem audiência v2 — ou o marcador de "o IC foi
  // consultado e não tinha" — sai a custo zero. Só o formato antigo (v ausente ou ≠ 2, que é
  // a migração v1→v2) é que volta a ser comprado, e o ?force=1 existe para quando se quer
  // mesmo pagar por dados frescos.
  const jaTem = c.audience != null && (c.audience.v === 2 || c.audience.sem_dados === true);
  if (jaTem && !force) {
    return NextResponse.json({
      creator: c.handle, atualizada: false, saltada: "já tem audiência — use ?force=1 para comprar de novo",
      credito_gasto: 0, sem_dados: !!c.audience.sem_dados, coletado_em: c.audience.coletado_em ?? null,
    });
  }

  const orc = await podeGastar(1);
  if (dry) {
    return NextResponse.json({
      dry: true, creator: c.handle, ja_tem_audiencia: c.audience != null,
      custaria: 1, saldo_ic: orc.saldo, piso: PISO, bloqueado_por: orc.ok ? null : orc.motivo,
    });
  }
  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_ic: orc.saldo, piso: PISO }, { status: 200 });

  const platform = c.platform === "tiktok" ? "tiktok" : "instagram";
  try {
    const full = (await ic("/public/v1/creators/enrich/handle/full/", { handle: c.handle, platform, include_audience_data: true })).result;
    const a = buildAudience(full?.[platform]?.audience?.audience_followers);
    if (!a) {
      await db.from("creators").update({ audience: semDados(c.audience) }).eq("id", c.id);
      return NextResponse.json({ creator: c.handle, atualizada: false, sem_audiencia: true, credito_gasto: 1, saldo_antes: orc.saldo });
    }
    await db.from("creators").update({ audience: a }).eq("id", c.id);
    return NextResponse.json({
      creator: c.handle, atualizada: true, credito_gasto: 1, saldo_antes: orc.saldo,
      nota: "a autoridade e a aderência só entram no Score KOL no próximo cálculo — /api/kol-score?handle=" + c.handle,
    });
  } catch (e) {
    // Falha depois de a chamada ter partido pode ter gasto o crédito na mesma; dizer que não
    // gastou seria mentir, e é assim que uma conta de fornecedor deixa de bater.
    return NextResponse.json({ creator: c.handle, atualizada: false, erro: String(e).slice(0, 200), credito_gasto: "talvez" }, { status: 200 });
  }
}

async function run(req) {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
  const sp = new URL(req.url).searchParams;
  const n = Number(sp.get("n")) || 15;
  const soBloqueados = sp.get("so") === "bloqueados";
  const dry = !!sp.get("dry");
  const umHandle = (sp.get("handle") || "").trim().replace(/^@/, "");
  const umId = (sp.get("id") || "").trim();
  const t0 = Date.now();
  const db = supabaseAdmin();

  // ── um creator só (ficha aberta) ──
  // Sai antes da montagem da fila: contar 403 candidatos para processar um é trabalho a mais,
  // e o `restantes` da fila não diz nada a quem pediu um creator.
  if (umHandle || umId) return await umSo(db, { handle: umHandle, id: umId, dry, force: !!sp.get("force") });

  const SEL = "id, handle, platform, audience, kol_score->geral->>kol_nao_avaliavel";
  // `order` estável: sem ele o Postgres devolve uma janela arbitrária e há candidatos que
  // nunca aparecem em corrida nenhuma. `count: exact` porque as contagens têm de valer
  // mesmo quando o Supabase corta as linhas em 1000.
  const [semAud, antigas] = await Promise.all([
    db.from("creators").select(SEL, { count: "exact" })
      .is("audience", null).not("handle", "is", null).order("id"),
    // v ausente ≠ v diferente de 2: as linhas do formato antigo não têm a chave de todo, e
    // `neq` sobre NULL não casa — descartava-as em silêncio. Verificado contra a base.
    db.from("creators").select(SEL, { count: "exact" })
      .not("audience", "is", null).or("audience->>v.is.null,audience->>v.neq.2")
      .not("handle", "is", null).order("id"),
  ]);
  if (semAud.error || antigas.error) {
    return NextResponse.json({ error: (semAud.error || antigas.error).message }, { status: 200 });
  }

  const bloqueado = (r) => r.kol_nao_avaliavel === "true";
  const nulos = semAud.data || [];
  const fila = [
    ...nulos.filter(bloqueado),
    ...(soBloqueados ? [] : nulos.filter((r) => !bloqueado(r))),
    ...(soBloqueados ? [] : (antigas.data || [])),
  ];
  const totalFila = soBloqueados ? nulos.filter(bloqueado).length : (semAud.count ?? 0) + (antigas.count ?? 0);

  // Piso ANTES de gastar (lib/ic-budget.js). O guard das rotas antigas lia `credits_left` da
  // resposta — verificava o saldo depois de o crédito já ter ido. Consultar o saldo custa 0
  // créditos, portanto entra também no dry-run: um dry que não diz quanto há em caixa não
  // responde à pergunta que se lhe faz.
  const orc = await podeGastar(1, { lote: true });
  const teto = orc.ok ? cabemNoOrcamento(orc.saldo, Math.min(n, fila.length)) : 0;

  if (dry) {
    return NextResponse.json({
      dry: true, creditos_que_seriam_gastos: teto,
      saldo_ic: orc.saldo, piso: PISO, fonte_do_saldo: orc.fonte ?? null,
      bloqueado_por: orc.ok ? null : orc.motivo,
      fila: totalFila, sem_audiencia: semAud.count ?? 0, bloqueados: nulos.filter(bloqueado).length,
      formato_antigo: antigas.count ?? 0,
      proximos: fila.slice(0, teto).map((r) => r.handle),
    });
  }

  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_ic: orc.saldo, piso: PISO, fila: totalFila }, { status: 200 });
  if (!teto) return NextResponse.json({ error: `saldo do IC no piso (${orc.saldo} disponíveis, piso ${PISO}) — nada foi gasto`, saldo_ic: orc.saldo, fila: totalFila }, { status: 200 });

  const pend = fila.slice(0, teto);
  let ok = 0, semaud = 0, fail = 0;
  for (const c of pend) {
    if (Date.now() - t0 > 240000) break;
    const platform = c.platform === "tiktok" ? "tiktok" : "instagram";
    try {
      const full = (await ic("/public/v1/creators/enrich/handle/full/", { handle: c.handle, platform, include_audience_data: true })).result;
      const aud = full?.[platform]?.audience?.audience_followers;
      const a = buildAudience(aud);
      if (!a) { await db.from("creators").update({ audience: semDados(c.audience) }).eq("id", c.id); semaud++; continue; }
      await db.from("creators").update({ audience: a }).eq("id", c.id); ok++;
    } catch (e) { fail++; }
  }
  return NextResponse.json({
    atualizadas: ok, sem_audiencia: semaud, falhas: fail, processadas: pend.length,
    // teto, não medição: uma falha de rede antes da chamada não gasta crédito, uma que
    // chegou ao IC gasta, e daqui não dá para distinguir as duas
    creditos_gastos_max: ok + semaud + fail,
    restantes: Math.max(0, totalFila - ok - semaud),
    fila: { total: totalFila, bloqueados: nulos.filter(bloqueado).length, sem_audiencia: semAud.count ?? 0, formato_antigo: antigas.count ?? 0 },
    nota: ok ? "correr /api/kol-score?all=1 depois: a autoridade e a aderência só entram no Score KOL no próximo cálculo" : undefined,
  });
}
