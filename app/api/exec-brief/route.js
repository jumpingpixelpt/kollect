import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { respostaErro } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx  → gera o dossiê executivo de 1 creator.
 * GET ?batch=N     → gera pra N creators que ainda não têm exec_brief (paralelo). Retorna {done, remaining}.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "exec-brief", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try {
    const sp = new URL(req.url).searchParams;
    const db = supabaseAdmin();
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 200 });

    const batch = sp.get("batch");
    if (batch) {
      const n = Math.min(Number(batch) || 8, 12);
      const { data: rows } = await db.from("creators").select("*").is("exec_brief", null).not("kol_screen", "is", null).limit(n);
      const res = await Promise.all((rows || []).map((c) => genOne(db, c).catch(() => false)));
      const done = res.filter(Boolean).length;
      const { count: remaining } = await db.from("creators").select("id", { count: "exact", head: true }).is("exec_brief", null).not("kol_screen", "is", null);
      return NextResponse.json({ done, tentados: rows?.length || 0, remaining: remaining ?? null });
    }

    const handle = sp.get("handle");
    const { data: c } = await db.from("creators").select("*").eq("handle", handle).single();
    if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
    const brief = await genOne(db, c);
    return NextResponse.json(brief ? { creator: c.handle, ...brief } : { error: "falha ao gerar" }, { status: 200 });
  } catch (e) {
    // mensagem amigável ao cliente; `detalhe` técnico só para o Bearer da orquestração (bug 1, set/2026)
    const { error, ...resto } = respostaErro(req, e, "exec-brief");
    return NextResponse.json({ fatal: error, ...resto }, { status: 200 });
  }
}

async function genOne(db, c) {
  const { data: fits } = await db.from("brand_fit").select("fit_score, rationale, brands(name, client)").eq("creator_id", c.id).order("fit_score", { ascending: false });
  const ks = c.kol_screen || {}; const m = ks.metricas || {}; const bh = c.brand_history || {}; const aud = c.audience || {};
  const cfits = (fits || []).filter((f) => (f.brands?.client || "loreal") === "loreal");
  const nichos = (bh.nichos || []).map((n) => `${n.nicho} ${n.pct}%`).join(", ") || c.niche;
  const formatos = [...new Set((bh.formatos || []).map((f) => typeof f === "string" ? f : f?.nome || f?.formato).filter(Boolean))].slice(0, 8).join(", ");
  const temas = [...new Set((bh.sub_nichos || []).map((s) => typeof s === "string" ? s : s?.nome).filter(Boolean))].slice(0, 8).join(", ");
  const reachTxt = m.reach_eff == null ? "—" : (m.reach_eff >= 10 ? "10×+" : `${m.reach_eff}×`);

  const dossie = `CREATOR: ${c.name} (@${c.handle}, ${c.platform}, ${c.followers} seguidores). Bio: ${c.bio || "—"}
CLASSE: ${ks.classe_label || ks.classe || "—"}
TERRITÓRIO (nichos): ${nichos}
SINAIS RELATIVOS AOS PARES (nicho ${m.niche_bucket}·faixa ${m.band}): Engagement Index ${m.eng_index ?? "—"}× a mediana · Reach Efficiency ${reachTxt} · Consistency ${m.consistency_pct ?? "—"}% · Território ${m.niche_density ?? "—"}% · Percentil ${m.follower_pct != null ? Math.round(m.follower_pct * 100) + "º" : "—"}
AUDIÊNCIA: ${aud.credibilidade_pct != null ? Math.round(aud.credibilidade_pct) + "% real/credível" : "—"}${aud.notaveis_pct != null ? `, ${Math.round(aud.notaveis_pct)}% contas notáveis` : ""}${aud.mulheres_pct != null ? `, ${aud.mulheres_pct}% mulheres` : ""}${aud.faixa_18_45_pct != null ? `, ${aud.faixa_18_45_pct}% 18-45` : ""}${aud.brasil_pct != null ? `, ${aud.brasil_pct}% Brasil` : ""}
FORMATOS QUE JÁ FAZ: ${formatos || "—"}
SUB-TEMAS: ${temas || "—"}
HISTÓRICO COMERCIAL: ${bh.resumo || "—"}
BRAND FIT (L'Oréal): ${cfits.map((f) => `${f.brands.name} ${f.fit_score}/100`).join(", ") || "—"}
SATURAÇÃO DE PUBLI: ${(ks.comercial || []).find((x) => x.id === "sat")?.resultado || "—"} | BETs: ${(ks.comercial || []).find((x) => x.id === "bets")?.resultado || "—"}`;

  const prompt = `Você é head de creator strategy da L'Oréal Brasil preparando o dossiê EXECUTIVO desta creator para apresentar ao time GLOBAL. Tom: decisão de negócio, premium, direto, sempre ancorado nos números do dossiê. Português do Brasil.

Responda APENAS com JSON válido, começando com {:
{"headline":"1-2 frases de DECISÃO em tom executivo (classe + território + qualidade da audiência + saturação comercial + pra que serve), SEM citar número ou cálculo — a matemática aparece nos blocos abaixo, a headline vende a decisão. Ex: 'KOL em cabelos crespos e transição capilar, com alta autoridade no território, audiência qualificada e baixa saturação comercial — recomendada para educação, transformação e credibilidade de produto.'",
"recommended_role":"o papel recomendado em 3-6 palavras (ex: 'KOL — Autoridade em Cabelos Crespos')",
"best_use":"3-4 usos separados por ' + ' (ex: 'Autoridade + Educação + Credibilidade de produto')",
"best_fit":["2-4 marcas/categorias do portfólio L'Oréal que mais encaixam"],
"not_ideal_for":"1 frase: onde NÃO usar (ex: 'Make glam pesado, fragrância de luxo, entretenimento de massa')",
"why_enters":[{"t":"Territory authority","d":"1 frase com número"},{"t":"Performance quality","d":"..."},{"t":"Audience fit","d":"..."},{"t":"Commercial opportunity","d":"..."},{"t":"Creative fit","d":"..."}],
"use_cases":[{"t":"título curto (ex: Educational Series)","d":"1 linha curta","best_for":"marca/uso ideal em 3-6 palavras","why_fits":"por que casa com ela, 1 linha curta"}],
"do":["5 diretrizes do que FAZER no conteúdo, curtas"],
"dont":["5 diretrizes do que NÃO fazer, curtas"],
"watchouts":["3-5 ressalvas honestas (por que NÃO é perfeita / quando testar antes)"],
"casting_role":{"primary":"papel primário","secondary":"papel secundário","funnel":"etapa do funil","function":"função do conteúdo em 3-5 palavras","placement":"posicionamento no squad"},
"client_defense":"1 parágrafo de defesa pronto pra colar num email/deck pro cliente, justificando a recomendação com os dados."}

"use_cases" com 4-5 itens, cada campo CURTO (escaneável pra apresentação). Use SOMENTE marcas L'Oréal (Elsève, Garnier, L'Oréal Paris, Kérastase, Maybelline) — nunca concorrentes. IMPORTANTE: para creators de base pequena/média, NÃO use "KOL consolidada" (soa exagerado) — prefira "KOL de nicho" ou "autoridade de nicho".

DOSSIÊ:
${dossie}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 26000);
  let txt = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2200, messages: [{ role: "user", content: prompt }] }),
    });
    clearTimeout(timer);
    const out = await res.json();
    if (res.ok) txt = out.content[0].text;
  } catch { clearTimeout(timer); }
  if (!txt) return null;
  let brief;
  try { brief = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]); } catch { return null; }
  if (!brief?.headline) return null;
  brief.gerado_em = new Date().toISOString().slice(0, 10);
  // Erro da gravação verificado de propósito: ver brand-scan. Devolver null faz o chamador
  // responder {error:"falha ao gerar"} em vez de assinar um sucesso que não existiu.
  const { error: ue } = await db.from("creators").update({ exec_brief: brief }).eq("id", c.id);
  if (ue) return null;
  return brief;
}
