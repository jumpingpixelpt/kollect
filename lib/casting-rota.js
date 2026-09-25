// Porta comum das rotas da lista de um briefing (/api/campanha-linhas, /api/campanha-card,
// /api/campanha-export): a mesma verificação da página /campanha/[id] — sessão (middleware)
// + veCampanha. Esconder a página não fecha a porta; a rota verifica por si.
import { supabaseServer } from "./supabase";
import { sessionRole, veCampanha } from "./auth-server";
import { lerCampanha, ehUuid } from "./casting-linhas";

/** { camp } quando o utilizador pode ver o briefing; senão { error } pronto para a resposta. */
export async function campanhaDoPedido(id, req = null) {
  if (!ehUuid(id)) return { error: "Briefing inválido." };
  // o bearer do CRON_SECRET é o sistema (crons, orquestradores): vê qualquer briefing
  if (req && ehSistema(req)) {
    const { data: camp, error } = await lerCampanha(supabaseServer, id);
    if (error && error.code !== "PGRST116") throw new Error(error.message);
    return camp ? { camp, db: supabaseServer } : { error: "Briefing não encontrado." };
  }
  const [{ user, role }, { data: camp, error }] = await Promise.all([sessionRole(), lerCampanha(supabaseServer, id)]);
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  // a mesma frase nos dois casos: um id alheio não confirma que o briefing existe (pentest set/2026)
  if (!camp || !veCampanha(camp, user?.id, role === "admin")) return { error: "Briefing não encontrado, ou não partilhado consigo — peça ao dono para o partilhar." };
  return { camp, db: supabaseServer };
}

const ehSistema = (req) => {
  const cron = process.env.CRON_SECRET;
  return !!cron && req?.headers?.get("authorization") === `Bearer ${cron}`;
};

/**
 * Uma linha do casting (campaign_creators.id) só se o briefing dela for visível ao utilizador
 * (pentest set/2026, IDOR: /api/campaign-status e /api/campaign-remove aceitavam qualquer
 * row_id). Devolve { linha, camp, db } ou { error }.
 */
export async function linhaCastingDoPedido(rowId, req = null) {
  if (!ehUuid(rowId)) return { error: "Linha inválida." };
  const { data: linha, error } = await supabaseServer.from("campaign_creators").select("id, campaign_id").eq("id", rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!linha) return { error: "Linha não encontrada." };
  const r = await campanhaDoPedido(linha.campaign_id, req);
  return r.error ? r : { linha, camp: r.camp, db: r.db };
}
