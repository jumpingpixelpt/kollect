import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase";
import { fold } from "@/lib/text";
import { erroPublico } from "@/lib/erro-publico";
import { tubularFetch, podeGastar, estimarCusto } from "@/lib/tubular-quota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Procurar fora da KOLLECT» — o último passo da busca do Creators Hub (feedback rodada 2,
 * F3.2 — set/2026).
 *
 * Quando nem a lista analisada nem a base de descoberta acham o nome, o Hub oferece um botão
 * que pergunta à Tubular (v4/creator.search, texto livre sobre nome e descrição do perfil,
 * só Brasil, beleza NÃO exigida — quem procura um nome sabe quem quer). Nunca corre ao
 * escrever: é sempre um clique, porque cada consulta gasta quota.
 *
 *   GET ?q=<nome ou @>
 *   → { q, resultados: [{ tubular_id, name, thumbnail, contas: [{ platform, handle, url,
 *        followers }], creator_id? }], custo_estimado }
 *
 * Custo (lib/tubular-quota.js, medido a 04/09/2026): 5 por linha + snippet 5 +
 * account_snippet 5 + account_performance 10 = 25 unidades por linha; com scroll.size 5,
 * ≤ 125 unidades por clique. Não toca no teto de vídeos únicos (só o video.search o faz, e
 * esse está esgotado até 01/10). O piso de quota vale aqui como em todo o lado: o
 * tubularFetch recusa ANTES de gastar, e a rota devolve a frase para o ecrã.
 *
 * A importação é o fluxo que já existe: «Trazer para a KOLLECT» manda o link da conta ao
 * /api/evaluate (o mesmo do «Avaliar perfil pelo link»), e a ficha enriquece com ?novo=1.
 */

const TAMANHO = 5;
const JUNK = new Set(["p", "reel", "reels", "stories", "explore", "video", "tag", "channel"]);

// @ a partir da URL da conta — o mesmo parser da Descoberta B (/api/discover-perfil)
function handleDe(plat, url) {
  const s = String(url || "");
  const m = plat === "instagram"
    ? s.match(/instagram\.com\/@?([A-Za-z0-9._]+)/)
    : s.match(/tiktok\.com\/@([A-Za-z0-9._]+)/);
  const h = m?.[1]?.replace(/\.+$/, "").toLowerCase() ?? null;
  return h && !JUNK.has(h) ? h : null;
}

const urlDe = (plat, h) => (plat === "tiktok" ? `https://www.tiktok.com/@${h}` : `https://www.instagram.com/${h}/`);

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "hub-busca-externa", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try {
    const bruto = String(new URL(req.url).searchParams.get("q") ?? "");
    const q = fold(bruto).replace(/^@+/, "").replace(/[^\p{L}\p{N}._ ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (q.length < 3) return NextResponse.json({ error: "Escreva pelo menos 3 letras do nome ou do @." });
    if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "A busca fora da KOLLECT não está disponível neste ambiente." });

    const corpo = {
      include: { search: q, countries: ["BR"], platforms: ["instagram", "tiktok"] },
      fields: { snippet: true, account_snippet: true, account_performance: true },
      scroll: { size: TAMANHO },
    };
    const custo = estimarCusto("/v4/creator.search", corpo);
    const guard = await podeGastar(custo, { nome: "busca fora da KOLLECT" });
    if (!guard.ok) {
      console.error("[hub-busca-externa] piso de quota:", guard.motivo);
      return NextResponse.json({ error: "A busca fora da KOLLECT está pausada neste momento (limite mensal do fornecedor). Volta a funcionar no início do próximo mês — até lá, use «Avaliar um perfil pelo link».", codigo: "quota" });
    }

    let json;
    try {
      ({ json } = await tubularFetch("/v4/creator.search", corpo, { origem: "hub:busca-externa" }));
    } catch (e) {
      if (e?.quotaBloqueada) {
        console.error("[hub-busca-externa] piso de quota:", String(e));
        return NextResponse.json({ error: "A busca fora da KOLLECT está pausada neste momento (limite mensal do fornecedor). Volta a funcionar no início do próximo mês — até lá, use «Avaliar um perfil pelo link».", codigo: "quota" });
      }
      throw e;
    }

    const resultados = [];
    for (const d of json?.results ?? []) {
      const contas = [];
      for (const plat of ["instagram", "tiktok"]) {
        const a = d?.accounts?.[plat];
        const h = handleDe(plat, a?.url);
        if (!h) continue;
        const f = Number(a?.performance?.followers);
        contas.push({ platform: plat, handle: h, url: urlDe(plat, h), followers: Number.isFinite(f) ? f : null });
      }
      if (!contas.length) continue;
      contas.sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
      resultados.push({ tubular_id: d.id, name: d.snippet?.title ?? contas[0].handle, thumbnail: d.snippet?.thumbnail ?? null, contas });
    }

    // quem já está na base aparece como link para a ficha, não como importação
    const handles = [...new Set(resultados.flatMap((r) => r.contas.map((c) => c.handle)))];
    if (handles.length) {
      const { data } = await supabase.from("creators").select("id, handle").in("handle", handles);
      const porHandle = new Map((data ?? []).map((c) => [String(c.handle).toLowerCase(), c.id]));
      for (const r of resultados) {
        const hit = r.contas.map((c) => porHandle.get(c.handle)).find(Boolean);
        if (hit) r.creator_id = hit;
      }
    }

    return NextResponse.json({ q, resultados, custo_estimado: custo });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "hub-busca-externa"), { status: 200 });
  }
}
