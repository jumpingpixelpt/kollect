import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { norm, ligarPecas } from "@/lib/marcas-pecas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Backfill das peças por marca no `brand_history` já gravado — sem Claude, sem Tubular.
 *
 * Feedback do cliente (set/2026, ponto 16): cada marca da ficha tem de ligar à peça em que
 * aparece, com a data de publicação. O brand-scan passou a gravar `pecas` (URL + data) em
 * cada marca, mas os 2.036 históricos já gravados não as têm. Reprocessar a base inteira
 * pelo brand-scan custaria ~2.000 chamadas ao Sonnet e a quota da Tubular (fechada até
 * 01/10) — e, sem Tubular, o scan cairia nas ~15 peças do banco e perderia marcas do ano.
 * Aqui faz-se o inverso: para cada marca já identificada, procura-se nas peças do banco
 * (legenda + fala) o nome da marca ou o trecho de evidência que o modelo citou, e liga-se.
 * O que não bater fica como estava; o próximo brand-scan da cadeia grava as peças de raiz.
 *
 * GET ?lote=200[&offset=0][&dry=1] — admin ou bearer. Devolve quantos históricos foram
 * tocados e quantas marcas ganharam peças; repete-se com offset até `restantes` ser 0.
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const lote = Math.min(Math.max(Number(sp.get("lote")) || 200, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const dry = sp.get("dry") === "1";
  const db = supabaseAdmin();

  const { data: creators, count } = await db.from("creators")
    .select("id, handle, brand_history", { count: "exact" })
    .not("brand_history", "is", null)
    .order("id")
    .range(offset, offset + lote - 1);

  let tocados = 0, marcasLigadas = 0, marcasTotal = 0, semVideos = 0;
  for (const c of creators ?? []) {
    const marcas = c.brand_history?.marcas;
    if (!Array.isArray(marcas) || !marcas.length) continue;
    const porFazer = marcas.filter((m) => m?.marca && !(Array.isArray(m.pecas) && m.pecas.length));
    if (!porFazer.length) continue;
    marcasTotal += porFazer.length;

    const { data: vids } = await db.from("videos").select("url, title, transcript, posted_at, views").eq("creator_id", c.id);
    const videos = (vids ?? []).map((v) => ({ ...v, txt: norm(`${v.title || ""} ${(v.transcript || "").slice(0, 2000)}`) }));
    if (!videos.length) { semVideos++; continue; }

    let mudou = false;
    const novas = marcas.map((m) => {
      if (!m?.marca || (Array.isArray(m.pecas) && m.pecas.length)) return m;
      const pecas = ligarPecas(m, videos);
      if (!pecas.length) return m;
      mudou = true; marcasLigadas++;
      const ultima = pecas.find((x) => x.data)?.data || m.ultima || null;
      return { ...m, pecas, ultima };
    });
    if (!mudou) continue;
    tocados++;
    if (!dry) {
      const { error } = await db.from("creators").update({ brand_history: { ...c.brand_history, marcas: novas } }).eq("id", c.id);
      if (error) return NextResponse.json({ error: `${c.handle}: ${error.message}`, tocados, marcasLigadas }, { status: 200 });
    }
  }

  const proximo = offset + (creators?.length ?? 0);
  return NextResponse.json({
    dry, lote, offset, processados: creators?.length ?? 0, total: count ?? null,
    restantes: Math.max(0, (count ?? 0) - proximo), proximo_offset: proximo,
    tocados, marcas_por_ligar: marcasTotal, marcas_ligadas: marcasLigadas, sem_videos: semVideos,
    versao: "2026-09-11a",
  });
}
