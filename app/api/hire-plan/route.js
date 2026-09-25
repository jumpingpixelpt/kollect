import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { classify, forecast } from "@/lib/forecast";
import { ErroProvedor } from "@/lib/erro-publico";
import { respostaErro, alertarIa } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx — plano de contratação escrito por IA sobre o dossiê completo:
 * tese, 3 recomendações citando os números, modalidade e primeiro passo.
 *
 * Erros (feedback rodada 2, bug 1): o cliente pede esta rota pelo botão da ficha, por isso
 * as falhas técnicas são lançadas e saem daqui como mensagem amigável; o `detalhe` só vai
 * a quem chama com o Bearer da orquestração.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "hire-plan", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); }
  catch (e) {
    const corpo = respostaErro(req, e, "hire-plan");
    await alertarIa(corpo, "hire-plan");
    return NextResponse.json(corpo, { status: 200 });
  }
}

async function run(req) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ErroProvedor("anthropic", 401, "ANTHROPIC_API_KEY não configurada");
  const sp = new URL(req.url).searchParams;
  const handle = sp.get("handle");
  const client = sp.get("client") === "pg" ? "pg" : "loreal";
  const clientLabel = client === "pg" ? "P&G" : "L'Oréal";
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("*").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });

  const [{ data: snaps }, { data: videos }, { data: fits }, { data: score }] = await Promise.all([
    db.from("snapshots").select("*").eq("creator_id", c.id).order("captured_at"),
    db.from("videos").select("title, views, content_score, analysis").eq("creator_id", c.id),
    db.from("brand_fit").select("fit_score, rationale, brands(name, client)").eq("creator_id", c.id).order("fit_score", { ascending: false }),
    db.from("scores").select("*").eq("creator_id", c.id).order("id", { ascending: false }).limit(1).single(),
  ]);

  const cfits = (fits || []).filter((f) => (f.brands?.client || "loreal") === client);
  const cls = classify(snaps || []);
  const fc = forecast(snaps || []);
  const bh = c.brand_history || {};
  const analisados = (videos || []).filter((v) => v.analysis?.veredicto);
  const mult = snaps?.length > 1 ? (snaps.at(-1).followers / snaps[0].followers).toFixed(1) : null;
  const ks = c.kol_screen || {}; const m = ks.metricas || {}; const aud = c.audience || {};
  const reachTxt = m.reach_eff == null ? "—" : (m.reach_eff >= 10 ? "10×+" : `${m.reach_eff}×`);

  const dossie = `CREATOR: ${c.name} (@${c.handle}, ${c.platform}) — ${c.followers} seguidores
NICHOS: ${JSON.stringify(bh.nichos ?? c.niche)}
CLASSE (modelo peer-relative, territory-strict): ${ks.classe_label || ks.classe || "—"}
SINAIS RELATIVOS AOS PARES (nicho ${m.niche_bucket ?? "—"} · faixa ${m.band ?? "—"}) — ESTA É A RÉGUA DE KOL QUE ENTREGA: Engagement Index ${m.eng_index ?? "—"}× a mediana dos pares · Reach Efficiency ${reachTxt} a própria base · Consistency ${m.consistency_pct ?? "—"}% dos posts · Território ${m.niche_density ?? "—"}% · Percentil de tamanho ${m.follower_pct != null ? Math.round(m.follower_pct * 100) + "º" : "—"}
AUDIÊNCIA: ${aud.credibilidade_pct != null ? Math.round(aud.credibilidade_pct) + "% real/credível" : "credibilidade —"}${aud.notaveis_pct != null ? `, ${Math.round(aud.notaveis_pct)}% contas notáveis` : ""}${aud.mulheres_pct != null ? `, ${aud.mulheres_pct}% mulheres` : ""}${aud.brasil_pct != null ? `, ${aud.brasil_pct}% Brasil` : ""}
RADAR SCORE (lente de MOMENTUM de crescimento — NÃO de qualidade): ${score?.total}/100 (Momentum ${score?.momentum}/35). Atenção: para um KOL já consolidado, Radar Score baixo reflete baixa ACELERAÇÃO de crescimento, não baixa qualidade — não use isso como motivo pra não contratar.
TRAJETÓRIA: multiplicou ${mult}x no período coberto; classificação: ${cls === "rising" ? "Rising Star (cresce e sustenta)" : cls === "momento" ? "Momento Viral (pico sem sustentação)" : "Em observação"}; forecast 30d: ${fc ? `${fc.direction} ${fc.delta30}%` : "indisponível"}
BRAND ENGAGEMENT: ${bh.brand_engagement?.leitura ?? "não medido"}
HISTÓRICO COMERCIAL: ${bh.resumo ?? "desconhecido"} | Marcas: ${(bh.marcas ?? []).map((m) => `${m.marca} (${m.tipo})`).join(", ") || "—"}
MARCAS DO CLIENTE (${clientLabel}) E FIT: ${cfits.length ? cfits.map((f) => `${f.brands.name} ${f.fit_score}/100`).join(", ") : "—"}
MELHOR BRAND FIT: ${cfits?.[0] ? `${cfits[0].brands.name} ${cfits[0].fit_score}/100 — ${cfits[0].rationale}` : "—"}
LEITURA DE CONTEÚDO: ${analisados.slice(0, 3).map((v) => v.analysis.veredicto).join(" | ") || "sem análise"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 1200,
      messages: [{ role: "user", content: `Você é head de creator strategy da ${clientLabel} Brasil. Com base no dossiê, escreva o plano de contratação deste creator para uma marca do portfólio ${clientLabel} — use SOMENTE marcas do cliente ${clientLabel} listadas no dossiê (jamais cite marcas concorrentes). Texto fluido, direto, sempre ancorado nos números do dossiê (cite-os). Sem jargão vazio.

DECIDA PELA CLASSE + SINAIS RELATIVOS AOS PARES + AUDIÊNCIA — essa é a régua de KOL que entrega. Se a creator é KOL/Rising do território com Engagement Index acima dos pares e audiência credível, a tese é de CONTRATAÇÃO de verdade (embaixador early ou pacote), NÃO um teste tímido. NÃO rebaixe a recomendação por causa de Radar Score baixo: ele é lente de momentum e pune quem já é consolidado. Reserve "teste pago de 1 vídeo" ou "não contratar agora" para quem tem sinais relativos fracos (Eng Index < 1, território difuso ou audiência pouco credível), não para um KOL de nicho forte. Para creators de base pequena/média, prefira o termo "KOL de nicho" ou "autoridade de nicho" em vez de "KOL consolidada" (que soa exagerado e gera debate).

Responda APENAS com JSON válido:
{"estrategia":"2-3 frases: a tese de contratação — por que (ou por que não) contratar agora, e o ângulo",
"recs":[{"titulo":"nome curto do formato/ação","porque":"1-2 frases citando números do dossiê","exemplo":"1 frase concreta de como seria o conteúdo"}],
"modalidade":"embaixador early | pacote de 3-5 vídeos | ação pontual de awareness | teste pago de 1 vídeo | não contratar agora",
"modalidade_porque":"1 frase",
"primeiro_passo":"1 frase acionável pro time esta semana"}

"recs" com exatamente 3 itens, em ordem de prioridade.

DOSSIÊ:
${dossie}` }],
    }),
  });
  const out = await res.json();
  if (!res.ok) throw new ErroProvedor("anthropic", res.status, out);
  let plan;
  try { const txt = out.content[0].text; plan = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); }
  catch { throw new Error(`hire-plan: resposta não-JSON — ${String(out.content?.[0]?.text ?? "").slice(0, 300)}`); }

  const col = client === "pg" ? "hire_plan_pg" : "hire_plan";
  // Erro da gravação verificado de propósito: ver brand-scan.
  const { error: ue } = await db.from("creators").update({ [col]: { ...plan, gerado_em: new Date().toISOString().slice(0, 10) } }).eq("id", c.id);
  if (ue) throw new Error(`${col} não gravado: ${ue.message}`);
  return NextResponse.json({ creator: c.handle, ...plan });
}
