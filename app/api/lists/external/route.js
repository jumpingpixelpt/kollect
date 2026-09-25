import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { internalHeaders } from "@/lib/internal-fetch";
import { fetchSquadSnapshot } from "@/lib/squad-data";
import { addSquadItems, parseSquadProfile, validSquadId } from "@/lib/squad-input";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
    const { list_id, url } = await req.json();
    if (!validSquadId(list_id)) return NextResponse.json({ error: "Selecione um squad." });
    const profile = parseSquadProfile(url);
    if (!profile) return NextResponse.json({ error: "Cole o link completo de um perfil do Instagram ou TikTok." });
    const db = supabaseAdmin();
    const { data: list, error: listError } = await db.from("lists").select("id").eq("id", list_id).maybeSingle();
    if (listError || !list) return NextResponse.json({ error: "Squad não encontrado. Nenhum perfil foi importado." });

    // Um perfil que já existe entra sem consumir outra avaliação; a rede faz parte
    // da identidade. Contas com o mesmo @ nunca são vinculadas automaticamente.
    const { data: existing, error: lookupError } = await db.from("creators")
      .select("id, handle, kol_geral:kol_score->geral").eq("platform", profile.platform)
      .ilike("handle", profile.handle.replace(/_/g, "\\_")).maybeSingle();
    if (lookupError) throw new Error("Não foi possível verificar o perfil na base.");
    let creator = existing;
    if (!creator) {
      if (!process.env.CRON_SECRET) throw new Error("A importação externa não está configurada neste ambiente.");
      const claimArgs = { p_platform: profile.platform, p_handle: profile.handle };
      const { data: claim, error: claimError } = await db.rpc("claim_squad_profile_import", claimArgs);
      if (claimError) throw new Error("Não foi possível iniciar a importação.");
      if (!claim) throw new Error("Este perfil já está sendo importado. Aguarde alguns minutos e tente incluí-lo novamente.");
      let settled = false;
      try {
        // Outro pedido pode ter terminado entre a primeira leitura e o claim.
        const { data: found, error: foundError } = await db.from("creators")
          .select("id, handle, kol_geral:kol_score->geral").eq("platform", profile.platform)
          .ilike("handle", profile.handle.replace(/_/g, "\\_")).maybeSingle();
        if (foundError) { settled = true; throw new Error("Não foi possível verificar o perfil na base."); }
        if (found) { creator = found; settled = true; }
        else {
          const response = await fetch(new URL("/api/evaluate", req.url), {
            method: "POST", headers: { ...internalHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ url: profile.url }), cache: "no-store", signal: AbortSignal.timeout(250000), redirect: "error",
          });
          const evaluated = await response.json().catch(() => null);
          settled = response.status < 500 && !!evaluated;
          if (!response.ok || evaluated?.error || evaluated?.fatal || !validSquadId(evaluated?.id)) {
            throw new Error(response.status === 401 ? "A importação não foi autorizada. Tente novamente mais tarde." : "Não foi possível importar o perfil. Confira se o link é público e tente novamente.");
          }
          creator = { id: evaluated.id, handle: evaluated.handle || profile.handle, kol_geral: null };
        }
      } finally {
        // Timeout/5xx pode deixar o avaliador rodando: conservar o lease até expirar
        // impede pagar outra chamada enquanto o resultado ainda é incerto.
        if (settled) {
          try { await db.rpc("release_squad_profile_import", { ...claimArgs, p_claim_token: claim }); }
          catch { /* O lease expira sozinho; o perfil confirmado permanece utilizável. */ }
        }
      }
    }
    const added = await addSquadItems(db, list_id, [{ creator_id: creator.id }]);
    const result = { ok: true, added, id: creator.id, handle: creator.handle, needsAnalysis: !creator.kol_geral };
    if (result.needsAnalysis) {
      // A cadeia histórica de enriquecimento ainda identifica por @. Não dispará-la
      // para homônimos em redes diferentes, onde poderia analisar a conta errada.
      try {
        const { data: namesakes, error: namesakeError } = await db.from("creators").select("id")
          .ilike("handle", profile.handle.replace(/_/g, "\\_")).limit(2);
        result.analysisBlocked = !!namesakeError || !namesakes || namesakes.some((row) => row.id !== creator.id);
      } catch { result.analysisBlocked = true; }
    }
    try { return NextResponse.json({ ...result, ...await fetchSquadSnapshot(db, list_id) }); }
    catch { return NextResponse.json({ ...result, refreshRequired: true, warning: "Perfil incluído. Atualize o squad para conferir os KPIs." }); }
  } catch (e) {
    return NextResponse.json({ error: e instanceof SyntaxError ? "Dados inválidos." : e.name === "TimeoutError" ? "A importação demorou mais que o esperado. Tente novamente para verificar o perfil." : e.message || "Não foi possível incluir o perfil." });
  }
}
