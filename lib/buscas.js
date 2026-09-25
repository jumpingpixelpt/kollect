// Histórico de buscas no servidor (feedback rodada 2, bug 2 — set/2026).
//
// A tabela `buscas` (supabase/migrations/202609210001_buscas.sql) só é lida e escrita pelo
// service role: a visibilidade é feita aqui, pelo utilizador da sessão — cada um vê as SUAS
// buscas não concluídas e as SUAS aberturas. Nem o admin vê as não concluídas dos outros:
// são rascunhos de quem os escreveu, não briefings.
import { supabaseAdmin } from "@/lib/supabase";

export const DIAS_PENDENTES = 30;

/**
 * Buscas do utilizador que não chegaram a briefing: lidas e não confirmadas, ou com a
 * leitura falhada. Últimos 30 dias, mais recentes primeiro. Falha → [] (a página abre na
 * mesma, só sem esta secção).
 */
export async function buscasPendentes(userId, limite = 20) {
  if (!userId) return [];
  try {
    const desde = new Date(Date.now() - DIAS_PENDENTES * 86400000).toISOString();
    const { data, error } = await supabaseAdmin().from("buscas")
      .select("id, texto, campos, estado, erro_codigo, created_at, updated_at")
      .eq("user_id", userId).eq("origem", "busca").in("estado", ["lido", "erro"]).is("campaign_id", null)
      .gte("created_at", desde)
      .order("updated_at", { ascending: false }).limit(limite);
    if (error) { console.error("[buscas] pendentes:", error.message); return []; }
    return (data ?? []).map((b) => ({
      id: b.id,
      titulo: String(b.campos?.titulo || "").trim() || resumo(b.texto),
      estado: b.estado,
      erro_codigo: b.erro_codigo,
      quando: b.updated_at || b.created_at,
    }));
  } catch (e) {
    console.error("[buscas] pendentes:", e);
    return [];
  }
}

/** { campaign_id: ISO da última abertura } das campanhas dadas, para o utilizador. */
export async function aberturas(userId, campaignIds = []) {
  if (!userId || !campaignIds.length) return {};
  try {
    const { data, error } = await supabaseAdmin().from("buscas")
      .select("campaign_id, aberto_em")
      .eq("user_id", userId).in("campaign_id", campaignIds).not("aberto_em", "is", null);
    if (error) { console.error("[buscas] aberturas:", error.message); return {}; }
    const out = {};
    for (const r of data ?? []) if (!out[r.campaign_id] || r.aberto_em > out[r.campaign_id]) out[r.campaign_id] = r.aberto_em;
    return out;
  } catch (e) {
    console.error("[buscas] aberturas:", e);
    return {};
  }
}

const resumo = (t) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > 90 ? `${s.slice(0, 87)}…` : s || "Busca sem título";
};
