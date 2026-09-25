import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { kolScore } from "@/lib/kolscore";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Score KOL (briefing L'Oréal §8) — calcula e persiste creators.kol_score.
 *
 *  GET ?id=uuid / ?handle=xxx → calcula e grava 1 creator (ID distingue redes)
 *  GET ?all=1[&offset=0]  → varre a base em lotes de 400 (chamar de novo com o
 *                           offset devolvido até restantes=0)
 *  GET ?stats=1           → distribuição (elegíveis, classes, saturação) — só leitura
 *
 * Persistido por creator: { geral: <resultado feminino/beauty>, masculino: <resultado
 * masculino/beauty>, versao, calculado_em }. O "geral" é a cara do briefing feminino;
 * o "masculino" alimenta o 2º briefing (Onda 2). O growth vem da view leaderboard
 * (growth_30d) — sem growth o creator não perde score, só não disputa rising_star.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const db = supabaseAdmin();
  const hoje = new Date().toISOString().slice(0, 10);

  if (sp.get("stats")) return NextResponse.json(await stats(db));

  const id = sp.get("id");
  const handle = sp.get("handle");
  if (id || handle) {
    const { data: c, error } = await db.from("creators")
      .select("id, handle, followers, kol_screen, brand_history, audience").eq(id ? "id" : "handle", id || handle).single();
    if (error || !c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
    const growth = await growthMap(db, [c.id]);
    const kol_score = calcular(c, growth.get(c.id), hoje);
    const { error: ue } = await db.from("creators").update({ kol_score }).eq("id", c.id);
    return NextResponse.json({ creator: c.handle, gravado: !ue, ...kol_score.geral });
  }

  if (sp.get("all")) {
    const LOTE = 400;
    const offset = Number(sp.get("offset")) || 0;
    const { data: creators, error } = await db.from("creators")
      .select("id, handle, followers, kol_screen, brand_history, audience")
      .order("id").range(offset, offset + LOTE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    if (!creators?.length) return NextResponse.json({ processados: 0, restantes: 0, offset });

    const growth = await growthMap(db, creators.map((c) => c.id));
    let gravados = 0, erros = 0;
    const falhas = [];
    for (const c of creators) {
      // isolamento por creator: uma linha envenenada não trava a varredura nem o avanço do offset
      try {
        const kol_score = calcular(c, growth.get(c.id), hoje);
        const { error: ue } = await db.from("creators").update({ kol_score }).eq("id", c.id);
        if (ue) { erros++; falhas.push({ handle: c.handle, erro: ue.message?.slice(0, 80) }); }
        else gravados++;
      } catch (e) {
        erros++;
        falhas.push({ handle: c.handle, erro: String(e).slice(0, 120) });
      }
    }
    const proximoOffset = offset + creators.length;
    const { count } = await db.from("creators").select("id", { count: "exact", head: true });
    return NextResponse.json({
      processados: creators.length, gravados, erros,
      falhas: falhas.slice(0, 10),
      offset: proximoOffset, restantes: Math.max((count ?? 0) - proximoOffset, 0),
    });
  }

  return NextResponse.json({ uso: "?id=uuid | ?handle=xxx | ?all=1[&offset=N] | ?stats=1" });
}

function calcular(c, growth30, hoje) {
  const dossie = {
    followers: c.followers,
    kol_screen: c.kol_screen,
    brand_history: c.brand_history,
    audience: c.audience,
    growth30_pct: growth30 ?? null,
  };
  return {
    versao: "v1",
    calculado_em: hoje,
    geral: kolScore(dossie, { territorio: "beauty", publico: "feminino", hoje }),
    masculino: kolScore(dossie, { territorio: "beauty", publico: "masculino", hoje }),
  };
}

async function growthMap(db, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const { data, error } = await db.from("leaderboard").select("id, growth_30d").in("id", part);
    // Ausência real de crescimento é null; falha na leitura não pode despromover uma
    // Rising Star e gerar uma nova transição/um novo e-mail quando a consulta voltar.
    if (error || !Array.isArray(data) || new Set(data.map((row) => row.id)).size !== part.length) {
      throw new Error("Não foi possível carregar o crescimento de todos os creators");
    }
    for (const r of data) if (r.growth_30d != null) {
      const growth = Number(r.growth_30d);
      if (!Number.isFinite(growth)) throw new Error("Crescimento inválido no histórico do creator");
      map.set(r.id, growth);
    }
  }
  return map;
}

async function stats(db) {
  const page = 1000;
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from("creators")
      .select("kol_score").not("kol_score", "is", null).order("id").range(from, from + page - 1);
    if (error || !data?.length) break;
    rows.push(...data);
    if (data.length < page) break;
  }
  const dist = { total: rows.length, elegiveis: 0, classes: {}, saturacao: {}, score: [] };
  for (const r of rows) {
    const g = r.kol_score?.geral;
    if (!g) continue;
    if (g.elegivel) { dist.elegiveis++; dist.score.push(g.score); }
    const cl = g.classe || (g.elegivel ? "elegivel" : "inelegivel");
    dist.classes[cl] = (dist.classes[cl] || 0) + 1;
    dist.saturacao[g.saturacao?.nivel || "?"] = (dist.saturacao[g.saturacao?.nivel || "?"] || 0) + 1;
  }
  dist.score.sort((a, b) => a - b);
  const pct = (p) => dist.score.length ? dist.score[Math.floor(dist.score.length * p)] : null;
  dist.score_percentis = { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) };
  delete dist.score;
  return dist;
}
