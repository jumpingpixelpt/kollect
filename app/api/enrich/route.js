import { NextResponse } from "next/server";
import { internalHeaders } from "@/lib/internal-fetch";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET ?handle=xxx[&completo=1] — enriquecimento de um creator recém-avaliado:
 * sync Tubular → backfill de histórico → scan de marcas → brand fit → audiência → KOL
 * screen → Radar Score → Score KOL → [corte] varredura de conteúdo → Radar Score de novo
 * → dossiê executivo → índice semântico. É o que transforma uma avaliação básica numa
 * página completa.
 *
 * O CORTE (decisão do Rui, 10/09/2026, para baixar o custo por creator): o deep-scan é
 * ~60% do custo da cadeia (~US$ 0,18 de ~US$ 0,30) e corria em toda a gente antes de se
 * saber se o creator interessava. Passa a correr só em quem é ELEGÍVEL no Score KOL —
 * território ≥50%, consistência mínima, sem red flag — que a 10/09 eram 795 de 2.142
 * (37%). Quem fica de fora não tem Autoridade no Radar nem temas, e é isso que se aceita:
 * a leitura completa continua a existir para quem conta, e o custo médio cai para perto
 * de metade. Sem Score KOL gravado (passo falhou), o corte fecha — gastar sem saber é o
 * que se quer evitar.
 *
 * `completo=1` ignora o corte. Usa-o o botão da ficha ("↻ Atualizar dados" e a primeira
 * análise da importação por link): quem abre UM perfil e pede a análise quer a análise.
 * As promoções em lote (descobertas, EvaluateBar) e a promoção via Apify ficam ao corte.
 * O casting não passa por aqui: o transcribe-casting chama o deep-scan directamente.
 *
 * hire-plan SAIU da cadeia (mesma decisão): é um dossiê em Sonnet que corria em todos os
 * creators e que nenhuma página monta (HirePlan.js não é importado por ninguém). Fica a
 * pedido, /api/hire-plan?handle=, para finalistas.
 *
 * O `brief` (/api/exec-brief) faltava aqui e não era chamado por mais ninguém na app:
 * um creator avaliado por link nunca chegava a ter `exec_brief`, e a dobra 01 da página
 * (Decision Snapshot) ficava permanentemente vazia. Corre depois do `kol` — o dossiê lê
 * kol_screen, brand_history, brand_fit e audience — e antes do `index`, que indexa o
 * exec_brief em creator_chunks.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "enrich", max: 10, janelaMs: 60_000 });
  if (travado) return travado;
  const handle = new URL(req.url).searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "handle obrigatório" }, { status: 400 });

  // Desde que o middleware fechou /api, uma chamada interna sem Bearer CRON_SECRET leva
  // 401 em TODOS os passos — a cadeia corria inteira, gastava minutos e devolvia um log
  // que ninguém lia, deixando o creator com a página vazia e sem explicação. Sem o
  // segredo não há cadeia possível: falha já, e diz o que falta configurar.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({
      handle,
      fatal: "CRON_SECRET não configurada — as chamadas internas da cadeia não têm como se autenticar no middleware e levariam 401 em todos os passos. Configure-a no ambiente (é obrigatória em produção desde que /api passou a ser fechado).",
    });
  }

  const completo = ["1", "true"].includes(new URL(req.url).searchParams.get("completo") || "");
  // conteudo=0: sem deep-scan nesta passagem, mesmo elegível. É o modo da importação em lote
  // (lib/promover-lote.js): o Gemini File API fecha ao fim de ~300 análises/dia e cada
  // tentativa a mais paga o Apify para nada; o drain fica para /api/cron/deep-scan-lote.
  const semConteudo = new URL(req.url).searchParams.get("conteudo") === "0";
  const base = new URL(req.url).origin;
  const steps = [
    ["sync", `/api/tubular-sync?handle=${handle}`],
    ["backfill", `/api/tubular-backfill?handle=${handle}`],
    ["marcas", `/api/brand-scan?handle=${handle}`],
    ["fit", `/api/pipeline/brand-fit?handle=${handle}`],
    // Audiência ANTES do kol/kol-score: a autoridade e a aderência saem daqui e valem 30% do
    // peso do Score KOL. A seguir seria calcular o score sem metade do que ele mede.
    //
    // Custa 1 crédito do influencers.club, e entra na cadeia por decisão do cliente
    // (jul/2026): a análise de audiência passa a ser automática nos dois caminhos de entrada
    // — "Avaliar perfil", que aterra na ficha e corre esta cadeia, e a promoção a partir das
    // descobertas. Não repete o erro do ic-shares que o post-mortem apanhou porque a rota é
    // idempotente: quem já tem audiência sai a custo zero, portanto um "↻ Atualizar dados"
    // não volta a pagar. Sem saldo acima do piso, salta e a cadeia segue.
    ["audiencia", `/api/audience-refresh?handle=${handle}`],
    // ic-shares SAIU da cadeia (decisão do cliente, jul/2026 — post-mortem dos créditos).
    // Custa 0,03 crédito/post do influencers.club e corria em todo creator de Instagram
    // enriquecido: 14.368 posts por preencher = ~431 créditos latentes, contra ~600 de saldo
    // restante no plano anual. O IC passa a estar reservado à demografia de audiência, que é
    // o único dado que só ele tem. A rota continua a existir para corridas manuais dirigidas
    // (/api/ic-shares?handle=), onde shares+saves valham mesmo o crédito.
    ["kol", `/api/kol-screen?handle=${handle}`],
    ["score", `/api/score?handle=${handle}`],
    ["kol-score", `/api/kol-score?handle=${handle}`],
    // Deep-scan DEPOIS do Score KOL, porque é o Score KOL que decide se corre (ver o
    // cabeçalho). O kol-score não lê nada do deep-scan (followers, kol_screen,
    // brand_history, audience, growth), portanto a ordem não lhe muda o resultado.
    ["conteudo", `/api/deep-scan?handle=${handle}`],
    // Conversa (feedback do cliente, set/2026, ponto 14): comentários lidos no Apify — paga,
    // por isso leva o MESMO corte do deep-scan (elegível no Score KOL, ou ?completo=1).
    ["conversa", `/api/conversa?handle=${handle}`],
    // Radar Score outra vez: a Autoridade sai do content_score que o deep-scan acabou de
    // gravar. A primeira passagem, antes do corte, serve o kol-screen (lê scores.momentum)
    // e a view leaderboard de que o kol-score tira o crescimento. Custo zero: é cálculo local.
    // Nome distinto para as duas passagens ficarem ambas no log.
    ["score-final", `/api/score?handle=${handle}`],
    ["brief", `/api/exec-brief?handle=${handle}`],
    ["index", `/api/creator-embeddings?handle=${handle}`],
  ];

  const log = {};
  const saidas = {}; // JSON de cada passo — o corte do deep-scan lê o do kol-score
  let ok = 0;
  let auth = null;
  for (const [nome, path] of steps) {
    if (nome === "conteudo" && semConteudo) {
      log[nome] = "saltado: conteudo=0 (importação em lote — o cron deep-scan-lote drena depois)";
      ok++;
      continue;
    }
    if (nome === "conversa" && new URL(req.url).searchParams.get("conteudo") === "0") {
      log[nome] = "saltado: conteudo=0 (importação em lote)";
      ok++;
      continue;
    }
    if ((nome === "conteudo" || nome === "conversa") && !completo) {
      const ks = saidas["kol-score"];
      if (ks?.elegivel !== true) {
        const falhou = Array.isArray(ks?.cortes) ? ks.cortes.filter((c) => !c.passou).map((c) => c.id).join(", ") : "";
        const motivo = ks ? `inelegível no Score KOL (corte: ${falhou || "?"})` : "sem Score KOL gravado";
        log[nome] = `saltado: ${motivo} — ?completo=1 força`;
        ok++; // é decisão, não falha: o botão da ficha não deve pintar "dados parciais"
        continue;
      }
    }
    try {
      // cache: "no-store" é obrigatório — sem ele o Data Cache do Next devolve a resposta
      // gravada da execução anterior para a mesma URL (são chaveadas por handle) e o passo
      // conta como "ok" sem a rota correr. Ver lib/internal-fetch.js.
      const r = await fetch(`${base}${path}`, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(nome === "conteudo" ? 200000 : 90000) });
      const txt = await r.text();

      // 401 é sempre estrutural (segredo errado ou middleware a recusar), nunca um problema
      // deste creator: os passos seguintes levariam o mesmo. Corta em vez de insistir.
      if (r.status === 401) {
        auth = `passo "${nome}" recusado com 401 — o Bearer CRON_SECRET das chamadas internas não é aceite pelo middleware (segredo diferente do configurado no ambiente).`;
        log[nome] = "erro: 401 não autorizado";
        break;
      }

      let j;
      try { j = JSON.parse(txt); }
      catch { log[nome] = `nao-JSON (HTTP ${r.status})${r.status === 302 ? " — proteção de deployment a bloquear a chamada interna" : ""}`; continue; }
      saidas[nome] = j;
      if (j.error || j.fatal) {
        log[nome] = `erro: ${(j.error || j.fatal + "").slice?.(0, 80) ?? "?"}`;
        // Os filhos respondem com a mensagem amigável (lib/erro-publico.js) e, porque esta
        // chamada leva o Bearer, com o `detalhe` técnico — que fica nos logs, não na resposta
        // (o EnrichButton da ficha lê esta rota com a sessão do cliente).
        if (j.detalhe || j.ref) console.error(`[enrich] ${handle} passo ${nome} ref=${j.ref ?? "-"}: ${j.detalhe ?? ""}`);
      } else {
        log[nome] = "ok";
        ok++;
      }
    } catch (e) {
      log[nome] = `timeout/falha: ${String(e).slice(0, 60)}`;
    }
  }

  // `enriquecimento` sozinho não distinguia "correu tudo" de "falhou tudo" — quem chama
  // dava a atualização por boa na mesma. O resumo é o que permite reportar a verdade.
  const falhas = steps.length - ok;
  return NextResponse.json({
    handle,
    enriquecimento: log,
    resumo: { passos: steps.length, ok, falhas },
    ...(auth ? { fatal: auth } : {}),
  });
}
