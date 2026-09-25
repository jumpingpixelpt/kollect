import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { radarScore } from "@/lib/score";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Recalcula o Radar Score. GET ou POST.
 *
 *   ?id=uuid / ?handle=xxx → só esse creator (ID evita homônimos entre redes)
 *   sem params   → varredura completa da base, paginada e com cursor
 *
 * Antes havia só o segundo modo, e era o que as cinco rotas chamadoras disparavam —
 * quatro delas para rescorar UM creator. Cada chamada percorria a base inteira: 1.761
 * creators × 2 queries sequenciais dentro de um maxDuration de 60s. Nunca terminava (os
 * 504 recorrentes em produção), e o `select` dos creators não paginava, portanto o tecto
 * de 1000 linhas do Supabase escondia 761 creators do scorer mesmo com tempo infinito.
 *
 * Consequência visível: um creator recém-importado ficava com o score-placeholder que o
 * RPC `ingest_profile` insere (total = eng_rate × 1.6, momentum/authority a zero) e nunca
 * era substituído pelo score verdadeiro. Como o `leaderboard` lê o score mais recente,
 * reimportar um creator até DESPROMOVIA quem já tinha score bom.
 */
export async function GET(req) { return POST(req); }

export async function POST(req) {
  // Sessão OU bearer, as mesmas do middleware — antes só o bearer, o que impedia um
  // rescore à mão. Redundante de propósito: ver lib/api-auth.js.
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });

  try {
    const sp = new URL(req.url).searchParams;
    const db = supabaseAdmin();
    const id = sp.get("id");
    const handle = sp.get("handle");

    if (id || handle) {
      const { data: c } = await db.from("creators")
        .select("id, handle, followers, brand_history").eq(id ? "id" : "handle", id || handle).single();
      if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
      const r = await scoreOne(db, c);
      return NextResponse.json({ creator: c.handle, ...r });
    }

    return await varreduraCompleta(db, sp);
  } catch (e) {
    return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 });
  }
}

/** Recalcula e grava o score de um creator. Devolve o resultado ou o erro, nunca lança. */
async function scoreOne(db, c) {
  try {
    const [{ data: snapshots, error: snapshotsError }, { data: videos, error: videosError }] = await Promise.all([
      db.from("snapshots").select("*").eq("creator_id", c.id).order("captured_at"),
      db.from("videos").select("content_score").eq("creator_id", c.id),
    ]);
    if (snapshotsError || videosError || !Array.isArray(snapshots) || !Array.isArray(videos)) {
      return { creator_id: c.id, err: "Não foi possível carregar os dados do Radar Score" };
    }
    const s = radarScore({
      snapshots: snapshots || [], videos: videos || [],
      followers: c.followers, brandHistory: c.brand_history,
    });
    const { error } = await db.from("scores").insert({ creator_id: c.id, ...s });
    return error ? { creator_id: c.id, err: error.message } : { creator_id: c.id, ...s };
  } catch (e) {
    return { creator_id: c.id, err: String(e).slice(0, 200) };
  }
}

/**
 * Varredura da base inteira, para o cron. Pagina por `id` (cursor estável, ao contrário
 * do range por offset, que salta linhas quando algo é inserido a meio) e trabalha em
 * lotes concorrentes — o custo real são as idas ao Supabase, não CPU. Para antes de
 * rebentar o maxDuration e devolve `proximo_cursor`, para o cron retomar onde ficou em
 * vez de recomeçar sempre pelos mesmos creators.
 */
async function varreduraCompleta(db, sp) {
  const LOTE = 10;                      // creators em paralelo
  const PAGINA = 500;                   // creators por página de leitura
  const TETO_MS = 260_000;              // margem para o maxDuration de 300s
  const arranque = Date.now();

  let cursor = sp.get("desde") || null;
  let scored = 0, erros = 0, restam = false;
  const falhas = [];

  while (true) {
    let q = db.from("creators").select("id, handle, followers, brand_history")
      .order("id").limit(PAGINA);
    if (cursor) q = q.gt("id", cursor);
    const { data: pagina, error } = await q;
    if (error) return NextResponse.json({ error: error.message, scored }, { status: 200 });
    if (!pagina?.length) break;

    for (let i = 0; i < pagina.length; i += LOTE) {
      if (Date.now() - arranque > TETO_MS) { restam = true; break; }
      const res = await Promise.all(pagina.slice(i, i + LOTE).map((c) => scoreOne(db, c)));
      for (const r of res) {
        if (r.err) { erros++; if (falhas.length < 20) falhas.push(r); } else scored++;
      }
      cursor = pagina[Math.min(i + LOTE, pagina.length) - 1].id;
    }
    if (restam || pagina.length < PAGINA) break;
  }

  return NextResponse.json({
    scored, erros, duracao_s: Math.round((Date.now() - arranque) / 1000),
    ...(falhas.length ? { falhas } : {}),
    ...(restam ? { incompleto: true, proximo_cursor: cursor } : {}),
  });
}
