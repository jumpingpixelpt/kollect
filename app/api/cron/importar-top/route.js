import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { promoverLote, candidatos, OR_PROMOVIVEIS } from "@/lib/promover-lote";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * IMPORTAÇÃO DO TOPO DAS DESCOBERTAS — cron temporário (pedido do Rui, 10/09/2026:
 * "importa das descobertas os 1000 melhores mini scores").
 *
 * Porquê um cron e não um separador do browser: uma promoção leva 3–5 min (Apify + cadeia
 * de enriquecimento) e 1.000 delas levam horas; o separador congela em segundo plano e uma
 * sessão criada pelo assistente derruba a do utilizador (sessão única por conta). O cron da
 * Vercel traz o Bearer, o lock está nos claims por prospect (lib/promover-lote.js), e o
 * estado vive em sweep_state, para ligar/desligar sem redeploy.
 *
 * Estado — sweep_state.importar_top = {
 *   ativo, mmin (corte de mini-score que define o topo), alvo, conc, orcamento_s, genre,
 *   plataforma (null = ambas; o corta-circuito de uma plataforma fecha-a aqui e a outra segue),
 *   sem_conteudo, promovidos_antes (fotografia no arranque — o progresso é a diferença,
 *   contada na base e não em memória, porque a invocação pode morrer a meio),
 *   corridas, iniciado_em, concluido_em, motivo, ultima
 * }.
 *
 * Duas regras de escrita, porque uma invocação vive 2–5 minutos:
 *  - NUNCA se grava a fotografia inteira lida ao arrancar: cada escrita relê a linha e põe
 *    por cima só o que este pedido é dono (`guardar(patch)`). Sem isto, um ?ativo=0 feito a
 *    meio de uma vaga era revertido quando ela chegava ao fim, e o cron continuava a pagar.
 *  - O caminho pago só escreve `ativo` para o pôr a false (fila vazia, alvo, corta-circuito).
 *
 * Operação (sessão de admin no browser ou Bearer):
 *  ?ativo=1|0 liga/desliga · ?mmin= ?alvo= ?conc= ?orcamento_s= ?genre= ?plataforma= ?sem_conteudo=0|1
 *  reconfiguram. Um pedido com parâmetros GRAVA E RESPONDE — não corre a vaga (isso é o
 *  cron, sem parâmetros, ou ?correr=1 explícito). ?dry=1 mostra a próxima vaga sem gastar.
 * Quando não há mais candidatos acima do corte, desliga-se sozinho. Retirar a entrada de
 * vercel.json quando terminar; até lá, cada invocação com ativo=false custa uma leitura.
 */
const KEY = "importar_top";
const VERSAO = "2026-09-11b";
const agora = () => new Date().toISOString();
// Status intermédios que as rotas de promoção escrevem enquanto trabalham. Se a rota morrer
// a meio ficam assim, sem timestamp: contam-se como "em curso ou presos" para o operador ver.
const OR_EM_CURSO = "status.like.promovendo:*,status.like.apify:perfil:*,status.like.apify:buscando*,status.like.apify-tk:perfil:*,status.like.apify-tk:por_post:*,status.like.ic:audiencia_saltada:*";

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json({ ...SO_ADMIN, versao: VERSAO }, { status: 403 });
  try {
    const sp = new URL(req.url).searchParams;
    const base = new URL(req.url).origin;
    const db = supabaseAdmin();
    const ler = async () => (await db.from("sweep_state").select("value").eq("key", KEY).maybeSingle()).data?.value || {};
    const cfg = { ativo: false, mmin: 75.6, alvo: 1000, conc: 5, orcamento_s: 120, genre: null, plataforma: null, sem_conteudo: true, corridas: 0, ...(await ler()) };
    // relê e sobrepõe só o patch; `patch` pode ser função do estado actual (incrementos)
    const guardar = async (patch) => {
      const atual = { ...cfg, ...(await ler()) };
      const value = { ...atual, ...(typeof patch === "function" ? patch(atual) : patch) };
      Object.assign(cfg, value);
      const { error } = await db.from("sweep_state").upsert({ key: KEY, value, updated_at: agora() }, { onConflict: "key" });
      if (error) throw new Error(`sweep_state: ${error.message}`);
    };
    const fotografia = async () => {
      const { count } = await db.from("prospects").select("tubular_id", { count: "exact", head: true }).eq("status", "promovido").gte("mini_score", cfg.mmin).not("handle", "is", null);
      return { promovidos_antes: count ?? 0, promovidos_antes_em: agora() };
    };

    // ── reconfiguração por query: grava e responde, não gasta ──
    const patch = {};
    for (const k of ["mmin", "alvo", "conc", "orcamento_s"]) if (sp.get(k) != null && Number.isFinite(Number(sp.get(k)))) patch[k] = Number(sp.get(k));
    if (sp.get("genre") != null) patch.genre = sp.get("genre") || null;
    if (sp.get("plataforma") != null) patch.plataforma = ["instagram", "tiktok"].includes(sp.get("plataforma")) ? sp.get("plataforma") : null;
    if (sp.get("sem_conteudo") != null) patch.sem_conteudo = sp.get("sem_conteudo") !== "0";
    if (sp.get("ativo") != null) {
      patch.ativo = ["1", "true"].includes(sp.get("ativo"));
      if (patch.ativo) { patch.iniciado_em = cfg.iniciado_em || agora(); patch.concluido_em = null; patch.motivo = null; }
    }
    if (Object.keys(patch).length) {
      Object.assign(cfg, patch);
      if (patch.mmin != null || !cfg.promovidos_antes_em) Object.assign(patch, await fotografia());
      await guardar(patch);
    }

    const progresso = async () => {
      const topo = (q) => q.gte("mini_score", cfg.mmin);
      const daPlat = (q) => cfg.plataforma ? q.eq("platform", cfg.plataforma) : q;
      const [{ count: prom }, { count: falh }, { count: radar }, { count: dup }, { count: fila }, { count: curso }, { count: semH }] = await Promise.all([
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).eq("status", "promovido").not("handle", "is", null)),
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).like("status", "falha_promocao:%")),
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).like("status", "ja_no_radar:%")),
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).like("status", "duplicado_handle:%")),
        daPlat(topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).not("handle", "is", null).or(OR_PROMOVIVEIS))),
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).or(OR_EM_CURSO)),
        topo(db.from("prospects").select("tubular_id", { count: "exact", head: true }).is("handle", null)),
      ]);
      return { promovidos: (prom ?? 0) - (cfg.promovidos_antes ?? 0), falhas: falh ?? 0, ja_no_radar: radar ?? 0, duplicados: dup ?? 0, na_fila: fila ?? 0, em_curso_ou_presos: curso ?? 0, sem_handle_fora_da_conta: semH ?? 0 };
    };

    if (sp.get("dry")) {
      const c = await candidatos(db, { mmin: cfg.mmin, genre: cfg.genre, plataforma: cfg.plataforma, limite: cfg.conc * 4 });
      return NextResponse.json({ versao: VERSAO, dry: true, cfg, progresso: await progresso(), proxima_vaga: c.lista.map((p) => ({ h: p.handle, pl: p.platform, mini: p.mini_score, f: p.followers, g: p.genre })), ja_no_radar: c.jaNoRadar.map((p) => p.handle), duplicados: c.duplicados.map((p) => p.handle), lixo: c.lixo.length });
    }
    if (Object.keys(patch).length && !sp.get("correr")) return NextResponse.json({ versao: VERSAO, guardado: true, cfg, progresso: await progresso() });
    if (!cfg.ativo) return NextResponse.json({ versao: VERSAO, parado: true, cfg, progresso: await progresso() });
    if (!cfg.promovidos_antes_em) await guardar(await fotografia()); // ligado por SQL: fotografia em falta

    const antes = await progresso();
    if (antes.na_fila === 0 || antes.promovidos + antes.falhas >= cfg.alvo) {
      await guardar({ ativo: false, concluido_em: agora(), motivo: antes.na_fila === 0 ? "fila vazia" : `alvo de ${cfg.alvo} atingido` });
      return NextResponse.json({ versao: VERSAO, concluido: true, cfg, progresso: antes });
    }

    await guardar((a) => ({ corridas: (a.corridas || 0) + 1, ultima: { em: agora() } }));
    const vaga = await promoverLote(db, { base, mmin: cfg.mmin, genre: cfg.genre, plataforma: cfg.plataforma, conc: cfg.conc, orcamentoMs: cfg.orcamento_s * 1000, semConteudo: cfg.sem_conteudo });
    const ultima = { em: cfg.ultima?.em, segundos: vaga.segundos, promovidos: vaga.promovidos, falhas: vaga.falhas, retentaveis: vaga.retentaveis, ja_no_radar: vaga.ja_no_radar, duplicados: vaga.duplicados, travadas: vaga.travadas };
    // Corta-circuito por plataforma: fecha a plataforma que falhou em série e segue com a outra;
    // se já só havia uma (ou as duas caíram), desliga.
    const travadas = Object.keys(vaga.travadas || {});
    const patchFim = { ultima };
    if (travadas.length) {
      const emJogo = cfg.plataforma ? [cfg.plataforma] : ["instagram", "tiktok"];
      const restantes = emJogo.filter((pl) => !travadas.includes(pl));
      const detalhe = travadas.map((pl) => `${pl}: ${vaga.travadas[pl]}`).join(" | ");
      if (restantes.length === 1 && cfg.plataforma == null) { patchFim.plataforma = restantes[0]; patchFim.motivo = `corta-circuito ${detalhe} — a continuar só ${restantes[0]}`; }
      else { patchFim.ativo = false; patchFim.motivo = `corta-circuito ${detalhe}`; }
    }
    const depois = await progresso();
    if (!travadas.length && depois.na_fila === 0) Object.assign(patchFim, { ativo: false, concluido_em: agora(), motivo: "fila vazia" });
    await guardar(patchFim);
    return NextResponse.json({ versao: VERSAO, cfg, vaga, progresso: depois });
  } catch (e) { return NextResponse.json({ versao: VERSAO, fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
