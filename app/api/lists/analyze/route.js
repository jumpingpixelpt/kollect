import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { internalHeaders } from "@/lib/internal-fetch";
import { validSquadId } from "@/lib/squad-input";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A importação e a análise têm pedidos separados para respeitar o tempo da Vercel.
// Compartilham o lease por rede/@ para não repetir uma cadeia paga entre squads.
export async function POST(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
    const { list_id, creator_id } = await req.json();
    if (!validSquadId(list_id) || !validSquadId(creator_id)) {
      return NextResponse.json({ error: "Squad ou perfil inválido." });
    }
    const db = supabaseAdmin();
    const { data: member, error: memberError } = await db.from("list_creators").select("id")
      .eq("list_id", list_id).eq("creator_id", creator_id).limit(1).maybeSingle();
    if (memberError || !member) return NextResponse.json({ error: "Este perfil não está no squad." });
    const readCreator = () => db.from("creators").select("id, handle, platform, kol_geral:kol_score->geral")
      .eq("id", creator_id).maybeSingle();
    const { data: creator, error: creatorError } = await readCreator();
    if (creatorError || !creator) throw new Error("Não foi possível consultar o perfil.");
    if (creator.kol_geral) return NextResponse.json({ ok: true, skipped: "Perfil já analisado." });
    if (!creator.handle || !["instagram", "tiktok"].includes(creator.platform)) {
      throw new Error("Este perfil não permite análise automática por link.");
    }
    // A cadeia legada identifica por @. Nunca escolher arbitrariamente uma rede.
    const { data: namesakes, error: namesakeError } = await db.from("creators").select("id")
      .ilike("handle", creator.handle.replace(/[_%\\]/g, "\\$&")).limit(2);
    if (namesakeError || namesakes?.length !== 1 || namesakes[0].id !== creator_id) {
      throw new Error("Não foi possível identificar uma única conta para este @. A análise permanece pendente.");
    }
    if (!process.env.CRON_SECRET) throw new Error("A análise não está configurada neste ambiente.");
    const args = { p_platform: creator.platform, p_handle: creator.handle };
    const { data: claim, error: claimError } = await db.rpc("claim_squad_profile_import", args);
    if (claimError) throw new Error("Não foi possível reservar a análise.");
    if (!claim) throw new Error("Este perfil já está em análise. Aguarde alguns minutos e atualize o squad.");
    let settled = false;
    try {
      // Uma análise pode ter concluído entre a primeira consulta e a reserva.
      const { data: fresh, error: freshError } = await readCreator();
      if (freshError || !fresh) { settled = true; throw new Error("Não foi possível consultar o perfil."); }
      if (fresh.kol_geral) { settled = true; return NextResponse.json({ ok: true, skipped: "Perfil já analisado." }); }
      const url = new URL("/api/enrich", req.url);
      url.searchParams.set("handle", creator.handle);
      const response = await fetch(url, {
        headers: internalHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(260000),
      });
      const result = await response.json().catch(() => null);
      settled = response.status < 500 && !!result;
      if (!response.ok || result?.error || result?.fatal || result?.resumo?.falhas !== 0) {
        throw new Error("O perfil está no squad, mas algumas etapas da análise não foram concluídas.");
      }
      return NextResponse.json({ ok: true });
    } finally {
      // Timeout/5xx pode deixar o enriquecimento em execução: o lease só expira
      // depois do limite da função interna, sem liberar outra cobrança incerta.
      if (settled) {
        try { await db.rpc("release_squad_profile_import", { ...args, p_claim_token: claim }); }
        catch { /* A reserva expira automaticamente. */ }
      }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "Dados inválidos." :
      error.name === "TimeoutError" ? "A análise ainda pode estar em andamento. Aguarde alguns minutos e atualize o squad." :
        error.message || "Não foi possível analisar o perfil." });
  }
}
