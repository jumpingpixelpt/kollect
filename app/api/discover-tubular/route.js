import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { funnelMiniScore } from "@/lib/score";
import { territorio, territorioDoDia, CHAVES } from "@/lib/territorios";
import { tubularFetch, podeGastar, cabemNoOrcamento, CUSTO, PISO, PISO_VIDEOS } from "@/lib/tubular-quota";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Descoberta de creators pela Tubular, em dois passos.
 *
 *   GET ?territorio=beauty|health|lifestyle  (omisso: o do dia, em rotação)
 *       &plataforma=tiktok|instagram|ambas   (omisso: ambas)
 *       &max=200                             tecto de creators; acima de 1500 corre EM CADEIA
 *                                            (elos de 1500, ver abaixo), até 15000
 *       &elo=2                               nº do elo — interno, posto pela própria cadeia
 *       &dias=3                              janela de publicação (1 a 1825 — até 5 anos)
 *       &keyword=minoxidil                   termo do operador — substitui as keywords do
 *                                            território em TODAS as consultas (o género e a
 *                                            banda de seguidores mantêm-se); no beauty, que
 *                                            não exige keyword, passa a exigi-la
 *       &ordem=engagements|views|upload_date ordenação dos vídeos
 *       &minviews=20000                      corte de views por vídeo
 *       &dry=1                               estima o custo e não gasta nada
 *       &dry=1&sonda=1                       além da estimativa, pergunta à Tubular quantos
 *                                            vídeos a janela devolve DE FACTO (campo `total`
 *                                            do v3, sondado pelo tubular-debug) — custa 1
 *                                            unidade por consulta (scroll_size: 1), e é o que
 *                                            permite ver o tamanho do lote antes de o pagar
 *
 * O CRITÉRIO: JANELA CURTA × ENGAGEMENT, NÃO VIEWS ACUMULADAS
 * Até 29/07 isto varria os últimos 30 dias ordenado por `views`. Duas consequências, ambas
 * medidas:
 *
 *   1. Devolvia SEMPRE os mesmos. O topo por views de uma janela de 30 dias é uma lista
 *      quase estática — corrê-la outra vez amanhã paga a quota toda outra vez para o dedup
 *      deitar quase tudo fora. Um radar que só sabe reencontrar quem já encontrou não é um
 *      radar.
 *   2. Ordenava para o oposto do produto. Os três primeiros vídeos vinham com 53,2M, 48,2M
 *      e 33,9M de views — mega-creators, exactamente quem o KOLLECT não precisa de descobrir
 *      porque o cachê já escalou. Por isso 27% do lote saía depois em `fora_da_faixa`.
 *
 * A Tubular não sabe ordenar por GANHO de engagement — `views_gain` e `engagements_gain`
 * existem como campos mas rebentam com `fetch_error` quando usados em `sort` (sondado a
 * 29/07). Não é preciso: a JANELA faz o "nos últimos três dias" e o SORT faz o "mais
 * engajamento". Ordenar por `engagements` dentro de uma janela de 3 dias é, por construção,
 * ordenar por engagement dos últimos 3 dias.
 *
 * A janela curta é também o que torna a descoberta renovável: desliza todos os dias, portanto
 * o cron das 05:00 vê conteúdo novo em vez de reler o mesmo mês. Os 3 dias (e não 1) dão
 * folga para um dia falhado do cron sem abrir buraco na cobertura.
 *
 * Ordenações válidas, sondadas uma a uma: `views`, `engagements`, `upload_date`. Todas as
 * outras (`publish_date`, `publish_timestamp`, `tvr`, `engagement_rate`, `velocity`) devolvem
 * 400 `invalid_post_data (sort)` — ao contrário dos FILTROS, que o endpoint ignora em
 * silêncio, o `sort` valida, e por isso um 200 aqui é prova de que a chave existe.
 *
 * PORQUE É QUE NÃO USA creator.search
 * O /v3/creator.search — o motor do /api/sweep — devolve 410 "deprecated and disabled" desde
 * meados de 2026. E o /v4/creator.search, que sobrevive, NÃO tem filtros: aceita só
 * `include.search` (texto livre) e `include.ids`, ignorando em silêncio qualquer outra chave
 * (verificado a 28/07 com uma chave inventada, que devolveu 200 e os mesmos resultados). Além
 * disso custa 40 unidades de quota por creator devolvido.
 *
 * CORRECÇÃO (04/09/2026): a sonda de 28/07 usou nomes de chave errados. Com os nomes do
 * spec público (`include.countries`, `include.genres` com ids inteiros,
 * `include.performance.followers`, `last_upload`, `rising_star`…) o /v4/creator.search
 * FILTRA, custa 5 unidades por linha só com ids, e devolve o @ via `fields.account_snippet`.
 * É o motor da Descoberta B (/api/discover-perfil), por PERFIL. Esta rota continua a ser a
 * Descoberta A, por CONTEÚDO — e o video.search continua a ser a única forma de descobrir
 * por keyword no vídeo, com o teto de vídeos únicos que isso implica.
 *
 * O CAMINHO QUE FUNCIONA
 *   1. /v3/video.search filtra a sério — creator_countries, creator_genres, creator_types,
 *      video_platforms, video_upload_date, video_views — e devolve o publisher de cada vídeo.
 *      Descobrir por vídeo recente encontra quem está a performar AGORA, que é o que um radar
 *      de rising stars quer; descobrir por perfil encontra quem já é grande. 1 unidade/vídeo.
 *   2. /v4/creator.monthly_trends grada o lote a 0,1 unidade por creator — 400× mais barato
 *      que o creator.search — e devolve, POR PLATAFORMA: seguidores, crescimento mês-a-mês,
 *      views a 30 dias e engagement rate. São os três inputs do funnelMiniScore mais a
 *      plataforma, que era o dado que se julgava indisponível na Tubular.
 *
 * Medido a 28/07: ~63 creators únicos por chamada de descoberta, e 38% do lote passa o filtro
 * de radar. Ver docs/descoberta-tubular-v4.md para os números e o método.
 */

const LOCK_KEY = "discover_tubular_lock";
const LOCK_MS = 6 * 60 * 1000;

/**
 * CADEIA — como se importam 15.000 quando a função morre aos 300s.
 *
 * Uma corrida síncrona não passa de ~1500 creators: são ~2.400 vídeos pedidos mais a
 * graduação, e o orçamento de tempo acaba. Acima de 1500 o pedido vira uma cadeia: cada elo
 * corre a sua fatia de 1500, grava o estado e responde `cadeia.continua` — e QUEM DISPARA O
 * ELO SEGUINTE É O BROWSER (DiscoveryRunner), não o servidor.
 *
 * A v1 auto-encadeava no servidor, no padrão do ic-sweep. Morreu duas vezes no MESMO sítio:
 * elos 1–5 nos logs do edge às 19:02→19:07 de 30/07, e o pedido do elo 6 simplesmente nunca
 * chegou — sem 401, sem erro, ausência total. É a protecção anti-recursão da Vercel a cortar
 * a linhagem de auto-invocações à quinta. Um pedido do browser nasce sem linhagem, portanto
 * o motor passa para lá: o custo é o separador ter de ficar aberto (~90s por elo), e o
 * benefício é a morte silenciosa desaparecer inteira — junto com a dependência do
 * CRON_SECRET para encadear.
 *
 * O que a cadeia guarda em sweep_state (uma linha, esta chave) é o que NÃO pode voltar a
 * pagar: os SCROLL TOKENS de cada consulta. Sem eles, o elo 2 recomeçava do topo da mesma
 * ordenação e pagava outra vez os 2.400 vídeos que o elo 1 já viu, para o dedup os deitar
 * fora — o custo de chegar aos 15.000 crescia ao quadrado. Token esgotado fica "FIM" e a
 * consulta sai das seguintes. Fechar o separador pausa a cadeia; um clique novo com os
 * mesmos parâmetros retoma-a do elo gravado (ver `canonico` abaixo).
 *
 * O lock normal continua a valer por elo. Tecto de 12 elos: trava de fuga, não meta.
 */
const CADEIA_KEY = "discover_tubular_cadeia";
const ELO_MAX = 1500;
const ELOS_MAX = 12;
const ALVO_MAX = 15000;

// Comparação de parâmetros à prova do jsonb: o Postgres reordena as chaves de um objeto
// jsonb (comprimento, depois alfabeto), portanto JSON.stringify(estado) nunca bateria com
// JSON.stringify(local) mesmo com valores iguais — e a retoma nunca dispararia.
const canonico = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, o[k] ?? null]));

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

/**
 * Lock por compare-and-set no sweep_state.
 *
 * O ic-sweep auto-encadeia sem lock nenhum: dois arranques sobrepostos (cron das 06:00 mais
 * o botão do operador) leem o estado no início e escrevem-no no fim, a última escrita ganha e
 * metade do trabalho perde-se em silêncio. Aqui o UPDATE só passa se o lock anterior já
 * expirou, e o próprio Postgres arbitra — duas invocações simultâneas não podem ambas ganhar.
 */
async function tentarLock(db) {
  const agora = new Date();
  const ate = new Date(agora.getTime() + LOCK_MS).toISOString();
  await db.from("sweep_state").insert({ key: LOCK_KEY, value: { ate: new Date(0).toISOString() } }).then(() => {}, () => {});
  const { data } = await db.from("sweep_state")
    .update({ value: { ate, dono: agora.toISOString() }, updated_at: agora.toISOString() })
    .eq("key", LOCK_KEY).lt("value->>ate", agora.toISOString())
    .select("key");
  return !!data?.length;
}
const largarLock = (db) =>
  db.from("sweep_state").update({ value: { ate: new Date(0).toISOString() } }).eq("key", LOCK_KEY).then(() => {}, () => {});

async function run(req) {
  if (!process.env.TUBULAR_API_KEY) return NextResponse.json({ error: "TUBULAR_API_KEY não configurada" }, { status: 200 });

  const sp = new URL(req.url).searchParams;
  const chave = sp.get("territorio") || territorioDoDia();

  // `todos` varre os três territórios na mesma corrida, como `ambas` faz para a plataforma.
  // Não é o modo do cron — esse roda um território por dia de propósito, para o custo diário
  // ser previsível — mas é o que o operador quer quando corre à mão e não sabe onde procurar.
  const chaves = chave === "todos" ? [...CHAVES] : [chave];
  const invalida = chaves.find((k) => !territorio(k));
  if (invalida) return NextResponse.json({ error: `território inválido: ${invalida}. Válidos: ${CHAVES.join(", ")}, todos` }, { status: 200 });

  const plataforma = sp.get("plataforma") || "ambas";
  const plats = plataforma === "tiktok" ? ["tiktok"] : plataforma === "instagram" ? ["instagram"] : ["tiktok", "instagram"];
  const db = supabaseAdmin();

  // ── cadeia: alvo total vs fatia deste elo ──
  const alvo = Math.min(Number(sp.get("max")) || 200, ALVO_MAX);
  const emCadeia = alvo > ELO_MAX;
  const eloPedido = Math.max(1, Number(sp.get("elo")) || 1);
  // até 1825 dias (5 anos): o operador pode varrer anos de uma vez. Nota de custo, não de
  // código — janelas longas encontram mais mas repetem mais do que a base já tem, e as
  // UNIDADES são cobradas por vídeo devolvido mesmo quando o dedup deita tudo fora
  // (lib/tubular-quota.js: só os vídeos ÚNICOS é que não recontam). E a ordenação por
  // engagement numa janela de anos devolve os maiores hits do período — a banda de
  // seguidores corta os megas, mas o lote puxa para quem já estourou. A janela curta
  // continua a ser o modo barato e renovável do cron.
  const dias = Math.max(1, Math.min(Number(sp.get("dias")) || 3, 1825));
  const minViews = Number(sp.get("minviews")) || 20000;
  // termo livre do operador — vai no `search` do include_filter, a única chave de texto que o
  // video.search aceita (ver o comentário das consultas). Substitui a lista do território:
  // quem escreve "minoxidil" quer minoxidil, não minoxidil mais seis termos de seed.
  const keyword = (sp.get("keyword") || "").trim().slice(0, 80) || null;

  // só estas três passam a validação do endpoint; qualquer outra dá 400 e mata a varredura
  const ORDENS = ["engagements", "views", "upload_date"];
  const ordem = ORDENS.includes(sp.get("ordem")) ? sp.get("ordem") : "engagements";
  const dry = !!sp.get("dry");

  // ── cadeia: estado herdado, e RETOMA quando o operador carrega outra vez ──
  //
  // A identidade da cadeia são os PARÂMETROS. Guardá-los no estado é o que permite duas
  // coisas que a v1 não tinha: (1) o clique repetido do operador com os mesmos parâmetros
  // RETOMA uma cadeia parada (elo perdido numa colisão de lock, deploy no meio, fatal
  // transitório) em vez de recomeçar do topo a repagar páginas; (2) parâmetros diferentes
  // recomeçam de propósito, porque são outra pesquisa.
  const paramsCadeia = { chave, plataforma, dias, minViews, keyword, ordem };
  let cadeia = null;
  let elo = eloPedido;
  if (emCadeia && !dry) {
    const { data } = await db.from("sweep_state").select("value, updated_at").eq("key", CADEIA_KEY).maybeSingle();
    const st = data?.value ?? null;
    const fresca = st && !st.done && data?.updated_at && Date.now() - new Date(data.updated_at).getTime() < 60 * 60000;
    if (eloPedido > 1) {
      if (!fresca) return NextResponse.json({ error: `cadeia não encontrada ou expirada no elo ${eloPedido} — recomeçar do painel` }, { status: 200 });
      cadeia = st;
    } else if (fresca && st.params && canonico(st.params) === canonico(paramsCadeia)) {
      // mesma pesquisa, cadeia viva mas órfã → continuar do ponto gravado
      cadeia = st;
      elo = Number(st.elo) + 1;
    }
  }
  const gravadosAntes = cadeia?.gravados ?? 0;
  const maxElo = Math.min(ELO_MAX, alvo - gravadosAntes);
  if (emCadeia && !dry && maxElo <= 0) {
    return NextResponse.json({ ok: true, cadeia: { alvo, elo, gravados_acumulados: gravadosAntes, continua: false, motivo: "alvo atingido" } });
  }
  // no dry estima-se a CADEIA INTEIRA — é o número que decide se se paga; a corrida real usa a fatia
  const max = dry ? alvo : (emCadeia ? maxElo : alvo);

  // ─── consultas: plataforma × termo ─────────────────────────────────────────
  //
  // O video.search aceita `search` no include_filter (verificado a 28/07; ao contrário de
  // video_title, keywords, video_keywords e video_themes, que devolvem 400). É o que torna
  // exequível o `exige_keyword` dos territórios.
  //
  // Sem isso o lifestyle é inutilizável: os géneros 16+7 devolvem 159 mil vídeos/30d e o que
  // sai é "No Controle Racing" e "AGORA EU SEI!" — só 28% do lote cai na faixa de seguidores,
  // contra 58% no beauty. Com `search`, o mesmo género 16 desce de 43.311 para 418 vídeos e
  // o que vem é do território. O beauty não precisa: o género 23 já É o território.
  //
  // Cada consulta carrega o SEU território: com `todos`, o género, a banda de seguidores e
  // a keyword mudam de consulta para consulta, e o creator tem de ser graduado pela banda do
  // território que o trouxe — não por uma qualquer que estivesse em escopo.
  const nTermos = Number(sp.get("termos")) || 6;
  const consultas = chaves.flatMap((k) => {
    const t = territorio(k);
    const termos = keyword ? [keyword] : (t.exige_keyword ? t.keywords.slice(0, nTermos) : [null]);
    return plats.flatMap((p) => termos.map((termo) => ({ chave: k, plat: p, termo })));
  });

  // Um só sítio para montar o filtro: a sonda do dry e a varredura a sério TÊM de perguntar
  // exactamente a mesma coisa, senão a contagem prometida e o lote entregue divergem — a
  // versão em dois sítios era como o FilterBar se desalinhou do list-filters.
  const hoje = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const filtroDe = (terr, plat, termo) => ({
    creator_countries: ["BR"],
    creator_genres: terr.generos,
    creator_types: ["influencer"], // corta brand e aggregator na origem, de graça
    video_platforms: [plat],
    video_upload_date: { min: desde, max: hoje },
    video_views: { min: minViews, max: 1000000000 },
    ...(termo ? { search: termo } : {}),
  });

  // ─── orçamento de varredura ────────────────────────────────────────────────
  //
  // Medido a 28/07: ~63 creators únicos por 100 vídeos no beauty (menos com termo, porque a
  // keyword estreita o lote). Cada consulta tem a sua fatia do tecto — ver o comentário do
  // ciclo — e a PÁGINA é dimensionada para encher essa fatia e mais nada.
  //
  // A página fixa de 200 vídeos só fazia sentido com 2 consultas. Com `territorio=todos` são
  // 26 (3 territórios × 13 termos × 2 plataformas) e custaria 5.200 unidades para depois se
  // graduarem `max` = 200: pagava-se a descoberta de ~2.000 creators para usar 10%. A página
  // adaptada faz o mesmo trabalho por ~1.300. O `scroll_size` é cobrado a 1 unidade por
  // vídeo, portanto encolhê-lo poupa proporcionalmente.
  const RENDIMENTO = 0.5; // creators únicos por vídeo devolvido, conservador
  const TECTO = Math.round(max * 1.5);
  const tectoConsulta = Math.max(10, Math.ceil(TECTO / consultas.length));
  const PAGINA = Math.max(50, Math.min(200, Math.ceil(tectoConsulta / RENDIMENTO)));
  const paginas = Math.max(1, Math.ceil(tectoConsulta / (PAGINA * RENDIMENTO)));
  const custoEstimado = paginas * consultas.length * PAGINA * CUSTO.video_search + max * CUSTO.monthly_trends;
  // vídeos únicos pedidos ao v3 — tecto mensal próprio, mais apertado que o das unidades
  const videosEstimados = paginas * consultas.length * PAGINA;

  const orc = await podeGastar(custoEstimado, { nome: "descoberta", videos: videosEstimados });

  if (dry) {
    // SONDA: pergunta o tamanho real do lote antes de o pagar. O v3 devolve `total` em
    // qualquer resposta (sondado no tubular-debug), portanto scroll_size: 1 compra a
    // contagem inteira por 1 unidade por consulta. É a diferença entre "estimo ~1.300
    // vídeos" e "há 418 vídeos nesta janela" — a segunda é a que decide se vale correr.
    //
    // Os totais por consulta SOMAM-SE com sobreposição: o mesmo creator pode aparecer em
    // duas consultas (dois termos, duas plataformas). O número honesto por consulta é
    // exacto; a soma é tecto, não promessa — e é assim que se apresenta.
    let sonda = null;
    if (sp.get("sonda")) {
      if (!orc.ok) {
        sonda = { erro: `sonda bloqueada: ${orc.motivo}` };
      } else {
        sonda = { consultas: [], total_videos_na_janela: 0, custo_da_sonda_unidades: consultas.length };
        let saldoSonda = null;
        for (const { chave: kTerr, plat, termo } of consultas) {
          try {
            const r = await tubularFetch("/v3/video.search", {
              query: { include_filter: filtroDe(territorio(kTerr), plat, termo) },
              fields: ["video_url"],
              scroll: { scroll_size: 1 },
            }, { origem: `sonda:${kTerr}:${plat}${termo ? ":" + termo : ""}` });
            saldoSonda = r.quota?.saldo ?? saldoSonda;
            const total = r.json?.total ?? r.json?.total_results ?? null;
            sonda.consultas.push({ territorio: kTerr, plataforma: plat, termo: termo ?? "(género é o território)", videos_na_janela: total });
            if (total != null) sonda.total_videos_na_janela += total;
          } catch (e) {
            sonda.consultas.push({ territorio: kTerr, plataforma: plat, termo: termo ?? "(género é o território)", erro: String(e).slice(0, 140) });
          }
        }
        // o funil a partir daqui: a corrida só PEDE `videosEstimados` desses; ~metade vira
        // creator único (RENDIMENTO, medido); dedup e banda de seguidores cortam depois
        const pedidos = Math.min(sonda.total_videos_na_janela, videosEstimados);
        sonda.videos_que_a_corrida_pede = pedidos;
        sonda.creators_estimados_antes_do_dedup = Math.round(pedidos * RENDIMENTO);
        if (saldoSonda != null) sonda.saldo_apos_sonda = Math.round(saldoSonda);
      }
    }

    return NextResponse.json({
      dry: true, territorio: chave, territorios: chaves, plataformas: plats,
      generos: chaves.flatMap((k) => territorio(k).generos),
      criterio: { ordem, dias, min_views: minViews, keyword },
      janela: { desde, ate: hoje },
      termos: consultas.filter((c) => c.plat === plats[0]).map((c) => `${c.chave}${c.termo ? ":" + c.termo : " (género é o território)"}`),
      consultas: consultas.length, paginas_por_consulta: paginas,
      custo_estimado_unidades: Math.round(custoEstimado),
      videos_unicos_pedidos: videosEstimados,
      videos_unicos_saldo: orc.videos?.restantes ?? null,
      videos_unicos_piso: PISO_VIDEOS,
      videos_unicos_expira: orc.videos?.expira ?? null,
      saldo_tubular: orc.saldo, piso: PISO, expira: orc.expira,
      leitura_do_saldo_ha_min: orc.idade_min ?? null,
      bloqueado_por: orc.ok ? null : orc.motivo,
      sonda,
    });
  }
  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_tubular: orc.saldo }, { status: 200 });

  let temLock = await tentarLock(db);
  // Um ELO barrado pelo lock não pode morrer à primeira: foi assim que a cadeia de 15000
  // parou em silêncio no elo 6 a 30/07 — o operador carregou no painel na janela de
  // milissegundos entre o elo 5 largar o lock e o elo 6 o pedir, e não havia segunda
  // tentativa. Três esperas de 8s cobrem uma corrida curta do operador; uma longa segura o
  // lock além disso e o elo desiste — mas agora a cadeia RETOMA-SE pelo clique (acima).
  if (!temLock && emCadeia && elo > 1) {
    for (let i = 0; i < 3 && !temLock; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      temLock = await tentarLock(db);
    }
  }
  if (!temLock) {
    // Se o lock pertence a uma CADEIA em curso, dizê-lo com o progresso — "já há uma
    // descoberta a correr" levou o operador a pensar que era um erro quando era a própria
    // cadeia dele a trabalhar (visto ao vivo a 30/07, no elo 3 de um alvo de 5000).
    const { data: cd } = await db.from("sweep_state").select("value, updated_at").eq("key", CADEIA_KEY).maybeSingle();
    const viva = cd?.value && !cd.value.done && Date.now() - new Date(cd.updated_at).getTime() < 10 * 60000;
    if (viva) {
      return NextResponse.json({
        error: `a tua cadeia está a correr — elo ${Number(cd.value.elo) + 1} em curso, ${cd.value.gravados} de ${cd.value.alvo} acumulados. Não precisas de carregar outra vez; acompanha pelas "Descobertas hoje".`,
        cadeia: { alvo: cd.value.alvo, gravados_acumulados: cd.value.gravados, elo_em_curso: Number(cd.value.elo) + 1, continua: true },
      }, { status: 200 });
    }
    return NextResponse.json({ error: "já há uma descoberta a correr (lock activo). Tenta daqui a uns minutos." }, { status: 200 });
  }

  const t0 = Date.now();
  const restante = () => 240000 - (Date.now() - t0);
  try {
    // ─── PASSO 1: descobrir ids por vídeo ──────────────────────────────────
    const achados = new Map(); // creator_id → { nome, plataforma, post_url, videos, views }
    let chamadas = 0, saldo = orc.saldo, videosSaldo = orc.videos?.restantes ?? null, lastErr = null;

    // TECTO POR CONSULTA, NÃO GLOBAL.
    //
    // O travão era `achados.size >= max * 1.5` sobre o `achados` acumulado ENTRE consultas.
    // Como elas correm em série, a primeira enchia o balde sozinha e as seguintes saíam no
    // primeiro break sem fazer uma única chamada. Medido a 29/07: uma corrida com
    // `plataforma=ambas` gravou 128 prospects, todos TikTok, zero Instagram — "ambas" era,
    // na prática, "só a primeira". O mesmo valia para os territórios com keyword, onde o
    // primeiro termo consumia a quota dos outros cinco.
    //
    // Cada consulta passa a ter a sua fatia (`tectoConsulta`, calculado com o orçamento lá
    // em cima). A rede global é a SOMA das fatias mais uma página de folga — uma página é
    // atómica, não se pode parar a meio dela. Um tecto global fixo reintroduzia o mesmo bug
    // um nível acima: com `todos`, os 300 esgotavam-se em beauty+health e o lifestyle nunca
    // chegava a fazer uma chamada.
    const TECTO_GLOBAL = consultas.length * tectoConsulta + PAGINA;

    // tokens de scroll deste elo, a gravar para o próximo. "FIM" = consulta esgotada.
    const tokensNovos = {};
    const chaveConsulta = (k, p, t) => `${k}|${p}|${t ?? ""}`;

    for (const { chave: kTerr, plat, termo } of consultas) {
      const terr = territorio(kTerr);
      const cKey = chaveConsulta(kTerr, plat, termo);
      const herdado = cadeia?.tokens?.[cKey] ?? null;
      if (herdado === "FIM") { tokensNovos[cKey] = "FIM"; continue; } // esgotada num elo anterior
      let token = herdado;
      let tocada = false; // já fez pelo menos uma chamada NESTE elo?
      const antes = achados.size;
      for (let p = 0; p < paginas; p++) {
        if (restante() < 20000 || achados.size >= TECTO_GLOBAL) break;
        if (achados.size - antes >= tectoConsulta) break;
        let r;
        try {
          r = await tubularFetch("/v3/video.search", {
            query: { include_filter: filtroDe(terr, plat, termo) },
            fields: ["video_url", "views", "engagements", "publisher"],
            sort: { sort: ordem, sort_reverse: true },
            scroll: token ? { scroll_size: PAGINA, scroll_token: token } : { scroll_size: PAGINA },
          }, { origem: `discover:${kTerr}:${plat}${termo ? ":" + termo : ""}` });
          chamadas++;
          tocada = true;
        } catch (e) { lastErr = String(e).slice(0, 200); break; }

        saldo = r.quota?.saldo ?? saldo;
        videosSaldo = r.quota?.videos?.restantes ?? videosSaldo;
        const vids = r.json?.videos ?? r.json?.results ?? [];
        token = r.json?.scroll_token ?? null;
        for (const v of vids) {
          const pub = v.publisher;
          if (!pub?.creator_id) continue;
          const e = achados.get(pub.creator_id) ?? {
            nome: pub.creator_name ?? null, plataforma: plat, post_url: v.video_url ?? null,
            genero: pub.creator_genre ?? null, chave: kTerr, termo: termo ?? kTerr, videos: 0, views: 0,
          };
          e.videos++; e.views += Number(v.views) || 0;
          if (!e.post_url && v.video_url) e.post_url = v.video_url;
          achados.set(pub.creator_id, e);
        }
        if (!vids.length || !token) { if (!vids.length) token = null; break; }
      }
      // Token nulo DEPOIS de uma chamada = a Tubular não deu mais páginas — esgotada. Mas uma
      // consulta que nem chegou a ser chamada neste elo (tempo esgotado, tecto global, erro na
      // primeira chamada) mantém o que herdou: marcá-la "FIM" era abandoná-la para sempre por
      // o elo ter sido lento — com `todos` (26 consultas), as do fim eram as sacrificadas.
      tokensNovos[cKey] = tocada ? (token ?? "FIM") : herdado;
    }

    // ─── dedup contra a base, PAGINADO ─────────────────────────────────────
    const existentes = await fetchAllRows(() => db.from("prospects").select("tubular_id, handle, post_url").order("tubular_id"));
    const jaCa = new Map(existentes.map((r) => [r.tubular_id, r]));
    // SELEÇÃO EQUILIBRADA — o corte a `max` não pode desfazer o equilíbrio da descoberta.
    //
    // O `.slice(0, max)` cortava por ordem de inserção na Map, e como as consultas correm
    // em série a primeira fica sempre à cabeça: mesmo com a descoberta já repartida, um
    // corte a 200 sobre 150 TikTok + 150 Instagram devolvia 150 e 50. Alterna entre
    // filas até ao tecto; quem tiver menos candidatos esgota e cede o resto aos outros.
    //
    // A fila é plataforma × território: com `todos`, equilibrar só por plataforma deixaria
    // o beauty — que tem 13× menos consultas mas muito mais volume — comer a quota do
    // health e do lifestyle dentro de cada plataforma.
    const ineditos = [...achados.entries()].filter(([id]) => !jaCa.has(id));
    // para o operador distinguir "já os tinha" de "cortei ao tecto" — sem isto, 382→200
    // lê-se como um corte só e a pergunta "porquê tão poucos?" não tem resposta no ecrã
    const jaNaBase = achados.size - ineditos.length;
    const filas = new Map();
    for (const e of ineditos) {
      const k = `${e[1].plataforma}|${e[1].chave}`;
      if (!filas.has(k)) filas.set(k, []);
      filas.get(k).push(e);
    }
    const novos = [];
    for (let i = 0; novos.length < max && [...filas.values()].some((f) => i < f.length); i++) {
      for (const f of filas.values()) {
        if (i < f.length && novos.length < max) novos.push(f[i]);
      }
    }

    // Repesca dos históricos: os 3.484 prospects de fonte `tubular` entraram sem handle
    // porque a Tubular não o dá, e o resolve-handles só os pode salvar se tiverem post_url.
    // Se a varredura reencontra um deles, o URL do post que veio de graça no video.search é
    // exactamente a peça que faltava — desperdiçá-lo por ser "duplicado" seria deitar fora a
    // única coisa nova que a chamada trouxe para essa linha.
    const repesca = [...achados.entries()]
      .filter(([id, info]) => {
        const j = jaCa.get(id);
        return j && !j.handle && !j.post_url && info.post_url;
      })
      .map(([id, info]) => ({ tubular_id: id, post_url: info.post_url }));
    let repescados = 0;
    if (repesca.length) {
      // payload só com tubular_id + post_url: o ON CONFLICT DO UPDATE do PostgREST toca
      // apenas nas colunas presentes, portanto o resto da linha fica intacto
      const { error } = await db.from("prospects").upsert(repesca, { onConflict: "tubular_id" });
      if (!error) repescados = repesca.length;
    }

    // ─── PASSO 2: graduar com monthly_trends ───────────────────────────────
    // lotes de 50: num lote de 100 ids vieram 50 resultados, e não ficou distinguido se é
    // tecto de página ou metade dos creators sem série. Assume-se o tecto.
    const metricas = new Map();
    for (let i = 0; i < novos.length; i += 50) {
      if (restante() < 15000) break;
      const lote = novos.slice(i, i + 50).map(([id]) => id);
      try {
        const r = await tubularFetch("/v4/creator.monthly_trends", { include: { ids: lote } }, { origem: `grade:${chaves.join("+")}` });
        chamadas++;
        saldo = r.quota?.saldo ?? saldo;
        videosSaldo = r.quota?.videos?.restantes ?? videosSaldo;
        for (const res of r.json?.results ?? []) {
          const cid = res.creator?.id; if (!cid) continue;
          metricas.set(cid, res.trends ?? []);
        }
      } catch (e) { lastErr = String(e).slice(0, 200); break; }
    }

    // ─── graduar e filtrar ─────────────────────────────────────────────────
    const linhas = [];
    let semMetricas = 0, foraDaFaixa = 0, inactivos = 0;

    for (const [cid, info] of novos) {
      const trends = metricas.get(cid);
      if (!trends?.length) { semMetricas++; continue; }

      const daPlat = trends.filter((t) => t.platform === info.plataforma)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      if (!daPlat.length) { semMetricas++; continue; }

      const ult = daPlat[daPlat.length - 1];
      const followers = Number(ult?.followers?.all_time) || 0;

      // CRESCIMENTO — só entre meses FECHADOS.
      //
      // O último elemento da série é o mês em curso, com só os dias já decorridos. Comparar
      // esse parcial com o mês anterior completo não mede 30 dias: no dia 2 do mês mede dois
      // dias e o creator parece estagnado, no dia 28 mede quase um mês. O `mini_score` dá 40
      // dos 100 pontos ao crescimento, portanto o artefacto deslocava a fila do funil
      // conforme o dia em que o cron corresse. Usa-se o último par de meses completos.
      const mesCorrente = hoje.slice(0, 7);
      const fechados = daPlat.filter((t) => String(t.month) < mesCorrente);
      const ultF = fechados[fechados.length - 1];
      const penF = fechados[fechados.length - 2];
      const f1 = Number(ultF?.followers?.all_time) || 0;
      const f0 = Number(penF?.followers?.all_time) || 0;
      const growthPct = f0 > 0 && f1 > 0 ? ((f1 - f0) / f0) * 100
        : (ultF?.followers?.month_over_month != null ? Number(ultF.followers.month_over_month) * 100 : null);

      const engPct = ult?.aggregated?.engagement_rate != null ? Number(ult.aggregated.engagement_rate) : null;
      const views30 = ult?.aggregated?.views_30_days != null ? Number(ult.aggregated.views_30_days) : null;

      // banda do território QUE O TROUXE — com `todos` em curso, cada creator tem a sua
      const faixa = territorio(info.chave).faixa;
      if (followers < faixa.min || followers > faixa.max) { foraDaFaixa++; continue; }
      if (!views30 && !info.views) { inactivos++; continue; }

      linhas.push({
        tubular_id: cid,
        name: info.nome,
        country: "BR",
        genre: info.chave,
        platform: info.plataforma,
        followers,
        growth_30: growthPct != null ? Math.round(growthPct * 100) / 100 : null,
        eng_rate: engPct != null ? Math.round(engPct * 100) / 100 : null,
        views_total: views30 ?? null,
        last_upload: hoje, // foi descoberto por um vídeo dentro da janela, logo está activo
        mini_score: funnelMiniScore({ engPct: engPct ?? 0, followers, growthPct }),
        fonte: "tubular-video",
        termo: info.termo ?? info.chave, // que consulta o trouxe — serve para afinar as seeds depois
        post_url: info.post_url,
        descoberto_em: hoje,
        status: "novo",
      });
    }

    let gravados = 0, erroGravacao = null;
    if (linhas.length) {
      const { error } = await db.from("prospects").upsert(linhas, { onConflict: "tubular_id", ignoreDuplicates: true });
      if (error) erroGravacao = error.message.slice(0, 200);
      else gravados = linhas.length;
    }

    // ── cadeia: gravar o estado, largar o lock, e SÓ DEPOIS disparar o próximo elo ──
    // (na ordem inversa, o elo seguinte chegava com o lock ainda na mão deste e morria)
    let cadeiaOut = null;
    if (emCadeia) {
      const gravadosAcum = gravadosAntes + gravados;
      const consultasVivas = Object.values(tokensNovos).some((t) => t !== "FIM");
      // progresso = ainda aparecem creators fora da base (mesmo que a graduação os tenha
      // filtrado todos neste elo — mais fundo na ordenação o perfil do lote muda), OU ainda
      // há consultas por tocar (token null = herdaram null e o elo não lhes chegou)
      const haPorTocar = Object.values(tokensNovos).some((t) => t === null);
      const continua = gravadosAcum < alvo && elo < ELOS_MAX && consultasVivas && (ineditos.length > 0 || haPorTocar);
      await db.from("sweep_state").upsert({
        key: CADEIA_KEY,
        // `params` é a identidade da cadeia — é o que deixa o clique repetido retomá-la
        value: { tokens: tokensNovos, gravados: gravadosAcum, alvo, elo, params: paramsCadeia, iniciado: cadeia?.iniciado ?? new Date().toISOString(), done: !continua },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      cadeiaOut = {
        alvo, elo, gravados_acumulados: gravadosAcum, continua,
        // o browser dispara o próximo elo com este número — o servidor já não se auto-invoca
        // (a Vercel corta a linhagem de auto-invocações à 5ª; ver o cabeçalho da CADEIA)
        proximo_elo: continua ? elo + 1 : null,
        motivo: continua ? null
          : gravadosAcum >= alvo ? "alvo atingido"
          : !consultasVivas ? "janela esgotada — a Tubular não tem mais páginas para estas consultas"
          : elo >= ELOS_MAX ? "tecto de elos"
          : "sem creators novos neste elo — parada por falta de progresso",
      };
    }

    return NextResponse.json({
      cadeia: cadeiaOut,
      ok: true,
      territorio: chave, territorios: chaves, plataformas: plats,
      generos: chaves.flatMap((k) => territorio(k).generos),
      criterio: { ordem, dias, min_views: minViews, keyword },
      janela: { desde, ate: hoje },
      descobertos: achados.size,
      por_plataforma: [...achados.values()].reduce((a, e) => ({ ...a, [e.plataforma]: (a[e.plataforma] ?? 0) + 1 }), {}),
      por_territorio: linhas.reduce((a, l) => ({ ...a, [l.genre]: (a[l.genre] ?? 0) + 1 }), {}),
      // onde é que o funil perde cada território — sem isto, um `gravados: 0` num território
      // é indistinguível entre "não encontrou nada" e "encontrou e foi tudo filtrado"
      funil_por_territorio: chaves.reduce((a, k) => {
        const desc = [...achados.values()].filter((e) => e.chave === k).length;
        const ined = novos.filter(([, e]) => e.chave === k).length;
        return { ...a, [k]: { descobertos: desc, ineditos: ined, gravados: linhas.filter((l) => l.genre === k).length } };
      }, {}),
      ja_na_base: jaNaBase,
      ineditos_totais: ineditos.length,
      novos_apos_dedup: novos.length,
      graduados: metricas.size,
      gravados,
      post_url_repescados: repescados,
      descartados: { sem_metricas: semMetricas, fora_da_faixa: foraDaFaixa, inactivos },
      chamadas_tubular: chamadas,
      saldo_tubular: saldo != null ? Math.round(saldo) : null,
      videos_unicos_saldo: videosSaldo != null ? Math.round(videosSaldo) : null,
      custo_real_estimado: orc.saldo != null && saldo != null ? Math.round(orc.saldo - saldo) : null,
      segundos: Math.round((Date.now() - t0) / 1000),
      proximo_passo: gravados ? "/api/resolve-handles — os prospects entram sem @, resolvido pelo URL do post" : null,
      erroGravacao, lastErr,
    });
  } finally {
    await largarLock(db);
  }
}
