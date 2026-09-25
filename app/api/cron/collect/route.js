import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { guardarAvatar } from "@/lib/avatar-store";
import { engRateViews } from "@/lib/engagement";
import { fetchAllRows } from "@/lib/fetch-all";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { squadScoreTargets, refreshCollectionScores } from "@/lib/collect-scores";
import { agendarRefrescoRadar } from "@/lib/radar-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Um creator com snapshot nos últimos FRESCO_DIAS não precisa de nova coleta. É este o
// mecanismo de rotação: quem é coletado hoje sai da fila durante uma semana, portanto a
// execução seguinte pega noutros. Sem isto a rota lia sempre a mesma lista pela mesma
// ordem e morria no tempo antes de sair dos primeiros — ~20 creators por dia, sempre os
// mesmos, com os restantes 1.700 a nunca receberem um snapshot.
const FRESCO_DIAS = 7;
const CONCORRENCIA = 8;   // coletas Apify em paralelo (o gargalo é rede, não CPU)
const TETO_MS = 220_000;  // deixa ~80s dos 300 para o rescore dos recolhidos
const TOTAL_MS = 290_000;

/**
 * Cron diário: varre os creators monitorados via Apify e grava um snapshot novo.
 * TikTok: clockworks/tiktok-scraper · Instagram: apify/instagram-profile-scraper
 *
 * ?dias=   janela de frescura (por omissão 7)
 * ?limite= tecto de creators nesta execução (por omissão só o tempo manda)
 */
export async function GET(req) {
  // Aceita as mesmas duas credenciais do middleware — antes era só o bearer, o que
  // recusava o operador autenticado e obrigava a esperar pelo cron das 06:00. Mantida
  // apesar de redundante: ver o porquê em lib/api-auth.js.
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });

  try { return await collect(req); }
  catch { return NextResponse.json({ error: "Não foi possível concluir a leitura para coleta", incompleto: true }); }
}

async function collect(req) {
  const token = process.env.APIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "APIFY_TOKEN não configurada — adicione nas env vars da Vercel" }, { status: 503 });

  const arranque = Date.now();
  const sp = new URL(req.url).searchParams;
  const dias = Math.max(Number(sp.get("dias")) || FRESCO_DIAS, 0);
  const limite = Math.max(Number(sp.get("limite")) || 0, 0);

  const db = supabaseAdmin();
  const collectSignal = AbortSignal.timeout(TETO_MS);
  const readAll = (build) => fetchAllRows(() => build().abortSignal(collectSignal), { strict: true });

  // O select não paginava: com o tecto de 1000 linhas do Supabase, 761 dos 1.761 creators
  // não existiam para o coletor, por muito tempo que ele tivesse.
  let creators = await readAll(() => db.from("creators")
    .select("id, handle, platform, kol_calculado_em:kol_score->>calculado_em").order("id"));
  // A paginação estrita impede que uma segunda página falhada deixe parte das squads
  // sem acompanhamento, aparentando uma execução completa.
  const squadMembers = await readAll(() => db.from("list_creators")
    .select("id, creator_id").not("creator_id", "is", null).order("id"));

  // ?briefing= restringe a coleta aos creators da aba Radar desse briefing — mesmo
  // racional do ?genre= no resolve-handles (ago/2026): um casting atualiza os SEUS
  // creators sem pagar Apify pela fila global (1,5k de 1,8k com snapshot >30d).
  const briefingId = sp.get("briefing");
  if (briefingId) {
    const membros = await readAll(() =>
      db.from("briefing_member_view").select("cid").eq("briefing_id", briefingId).not("cid", "is", null).order("cid"));
    const doBriefing = new Set(membros.map((m) => m.cid));
    creators = creators.filter((c) => doBriefing.has(c.id));
  }

  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const recentes = await readAll(() => db.from("snapshots").select("creator_id, captured_at")
    .gte("captured_at", desde).order("creator_id").order("captured_at").order("id"));
  const frescos = new Set(recentes.map((r) => r.creator_id));

  // Só quem está sem snapshot recente entra na fila paga.
  const squadIds = new Set(squadMembers.map((member) => member.creator_id));
  const pendentes = creators.filter((c) => !frescos.has(c.id))
    .sort((a, b) => Number(squadIds.has(b.id)) - Number(squadIds.has(a.id)));
  // O limite de tempo/custo continua o mesmo; squads ganham prioridade para que a
  // fila global não deixe seus alertas dependentes de snapshots antigos por meses.
  const alvos = limite ? pendentes.slice(0, limite) : pendentes;
  const results = [];

  const coleta = async (c) => {
    try {
      const actor = c.platform === "tiktok" ? "clockworks~tiktok-scraper" : "apify~instagram-profile-scraper";
      const input = c.platform === "tiktok"
        ? { profiles: [c.handle], resultsPerPage: 10, shouldDownloadVideos: false }
        : { usernames: [c.handle] };

      const remaining = TETO_MS - (Date.now() - arranque);
      if (remaining <= 0) throw new Error("Tempo de coleta esgotado");
      const response = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=120`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
          signal: AbortSignal.timeout(Math.max(1, Math.min(125_000, remaining))) }
      );
      if (!response.ok) throw new Error(`Coleta indisponível (HTTP ${response.status})`);
      const run = await response.json();

      const p = Array.isArray(run) ? run[0] : null;
      if (!p) throw new Error("Apify não devolveu perfil");

      const followers = p.followersCount ?? p.authorMeta?.fans ?? p.fans ?? null;
      const avatar = p.profilePicUrlHD ?? p.profilePicUrl ?? p.authorMeta?.avatar ?? null;
      const videos = Array.isArray(run) ? run.filter((i) => i.playCount != null || i.videoPlayCount != null) : [];
      const views = videos.map((v) => v.playCount ?? v.videoPlayCount ?? 0);
      const likes = videos.map((v) => v.diggCount ?? v.likesCount ?? 0);
      const comments = videos.map((v) => v.commentCount ?? v.commentsCount ?? 0);
      const shares = videos.map((v) => v.shareCount ?? 0);
      const saves = videos.map((v) => v.collectCount ?? 0);
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      const avgViews = views.length ? Math.round(sum(views) / views.length) : null;
      const engRate = engRateViews(sum(likes) + sum(comments) + sum(shares), sum(views));
      const savesPer1k = sum(views) ? +(sum(saves) / sum(views) * 1000).toFixed(2) : null;
      const sharesPer1k = sum(views) ? +(sum(shares) / sum(views) * 1000).toFixed(2) : null;

      if (followers != null && Number.isFinite(Number(followers)) && Number(followers) > 0) {
        const hoje = new Date().toISOString().slice(0, 10);
        // O snapshot só marca a coleta como fresca depois que o perfil foi salvo.
        const { error: creatorError } = await db.from("creators")
          .update({ followers, ...(avatar ? { avatar_url: avatar } : {}) }).eq("id", c.id).abortSignal(collectSignal);
        if (creatorError) throw new Error("Falha ao atualizar o creator");
        // foto durável enquanto a assinatura do URL vale (lib/avatar-store.js); best-effort
        if (avatar) await guardarAvatar(db, c.id, avatar, { timeoutMs: 6000 });
        // idempotente: uma segunda passagem no mesmo dia substitui, não duplica
        const { error: deleteError } = await db.from("snapshots").delete().eq("creator_id", c.id)
          .eq("captured_at", hoje).abortSignal(collectSignal);
        if (deleteError) throw new Error("Falha ao preparar o snapshot");
        const { error: snapshotError } = await db.from("snapshots").insert({
          creator_id: c.id, captured_at: hoje,
          followers, avg_views: avgViews, eng_rate: engRate,
          saves_per_1k: savesPer1k, shares_per_1k: sharesPer1k,
        }).abortSignal(collectSignal);
        if (snapshotError) throw new Error("Falha ao gravar o snapshot");
      } else throw new Error("Perfil sem contagem válida de seguidores");
      results.push({ id: c.id, handle: c.handle, ok: true, followers });
    } catch (e) {
      results.push({ id: c.id, handle: c.handle, ok: false,
        error: e?.name === "TimeoutError" || e?.name === "AbortError" ? "Tempo de coleta esgotado" : String(e).slice(0, 160) });
    }
  };

  // Coleta em lotes concorrentes e com relógio à vista: o gargalo é a espera pelo Apify,
  // não o CPU. Antes era um for sequencial sem limite de tempo — a função era morta a
  // meio pelo runtime, e o que ficava por fazer não era reportado a ninguém.
  let cortado = false;
  for (let i = 0; i < alvos.length; i += CONCORRENCIA) {
    if (TETO_MS - (Date.now() - arranque) < 15_000) { cortado = true; break; }
    await Promise.all(alvos.slice(i, i + CONCORRENCIA).map(coleta));
  }

  // Recalcula o score de quem acabou de receber snapshot novo — os outros não mudaram.
  // Antes disparava a varredura da base inteira e esperava por ela DENTRO do próprio
  // orçamento de 300s, o que fazia esta rota estourar o tempo junto com o /api/score.
  //
  // AS AUTO-CHAMADAS VÃO COM internalHeaders(), NÃO COM O HEADER DO PEDIDO DE ENTRADA.
  //
  // Reencaminhar o `authorization` recebido só funciona quando quem chamou foi o cron da
  // Vercel. O operador autenticado no browser — que o lib/api-auth.js existe precisamente
  // para deixar disparar isto à mão — traz cookie de sessão e header nenhum, portanto os
  // rescores saíam sem credencial e levavam 401 do middleware. E ninguém reparava: o fetch
  // resolve em 4xx (o .catch não vê nada) e a resposta continuava a dizer `rescorados: N`.
  // Nos previews faltava ainda o bypass da proteção de deployment, que o helper também
  // injeta. Era a única chamada a rota irmã do repositório fora do helper.
  const recolhidos = results.filter((r) => r.ok);
  // Se uma execução anterior gravou o snapshot mas ficou sem tempo para o Score KOL,
  // retoma somente os cálculos locais. Não espera sete dias nem repaga a coleta.
  const squadTargets = squadScoreTargets(creators, squadMembers, recentes, recolhidos);
  const scores = await refreshCollectionScores({ collected: recolhidos, squadTargets,
    requestUrl: req.url, deadline: arranque + TOTAL_MS });
  const falhas = results.filter((r) => !r.ok);
  // snapshots novos → a base do Creators Hub (radar_cache) remonta-se já, por trás da resposta
  if (recolhidos.length) agendarRefrescoRadar();
  const incompleto = cortado || falhas.length > 0 || scores.rescore_falhas > 0 || scores.tags_falhas > 0 ||
    scores.rescore_pendentes > 0 || scores.tags_pendentes > 0;
  return NextResponse.json({
    base: creators.length,
    pendentes: pendentes.length,
    coletados: recolhidos.length,
    falhados: falhas.length,
    ...scores,
    duracao_s: Math.round((Date.now() - arranque) / 1000),
    ...(incompleto ? { incompleto: true, restantes: alvos.length - results.length } : {}),
    ...(falhas.length ? { erros: falhas.slice(0, 20) } : {}),
  });
}
