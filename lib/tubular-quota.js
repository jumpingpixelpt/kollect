import { supabaseAdmin } from "@/lib/supabase";

/**
 * Orçamento da Tubular Labs — quota mensal, medida.
 *
 * Contexto (28/07/2026): durante a investigação aos endpoints v4 descobriu-se que a Tubular
 * expõe a quota em CABEÇALHOS de resposta, e que ninguém no repositório os lia. No momento
 * da medição estavam consumidas 787.253 de 1.000.000 de unidades do mês — 79% — sem que
 * houvesse forma de saber. É a mesma cegueira que esvaziou o plano do influencers.club,
 * noutro fornecedor; a diferença é que aqui foi apanhada antes de custar a entrega.
 *
 * Cabeçalhos que vêm em qualquer resposta:
 *
 *   tubular-quota-units-limit          1000000
 *   tubular-quota-units-remaining      212747.6
 *   tubular-quota-units-consumed       100.0      ← desta chamada
 *   tubular-quota-units-expires-after  2026-07    ← mensal, NÃO transita
 *   tubular-quota-rows-consumed        5
 *   tubular-ratelimit / -remaining     6
 *   tubular-concurrencylimit           1          ← uma chamada de cada vez
 *
 * O custo por chamada varia 400× entre endpoints (medido, ver docs/descoberta-tubular-v4.md):
 *
 *   creator.monthly_trends   0,1 / creator (lote de 100 = 10 unidades)
 *   video.search               1 / vídeo
 *   creator.trends            ~36 / creator
 *   creator.summary            20 / linha-plataforma
 *   creator.search              5 / creator só com ids; +5 snippet, +5 account_snippet,
 *                                 +10 performance/account_performance, +20 taxonomy (40 era
 *                                 snippet+performance+taxonomy). Os FILTROS funcionam —
 *                                 sondado a 04/09/2026, ver /api/discover-perfil; a nota de
 *                                 28/07 ("sem filtros") vinha de nomes de chave errados
 *
 * Escolher o endpoint errado é a diferença entre varrer o mercado inteiro e esgotar o mês
 * numa tarde. Por isso o custo estimado é explícito em cada chamada e o piso é verificado
 * ANTES, nunca a partir da resposta que já foi paga.
 */

const STATE_KEY = "tubular_quota";

// piso abaixo do qual nada corre. Sobrepõe-se por TUBULAR_UNIT_FLOOR no ambiente.
export const PISO = Number(process.env.TUBULAR_UNIT_FLOOR) || 20000;

/**
 * SEGUNDO TECTO: vídeos únicos por mês.
 *
 * Só o v3 o expõe (`tubular-ratelimit-uniquevideolimit-*`), e é bastante mais apertado que as
 * unidades: 100.000 vídeos contra 1.000.000 de unidades. Como o video.search custa 1 unidade
 * POR VÍDEO, uma varredura consome os dois recursos ao mesmo ritmo — mas esgota os vídeos
 * dez vezes mais depressa. Medido a 29/07: restavam 199 mil unidades (80% gastas) e 81 mil
 * vídeos (19% gastos), o que só desmente a aritmética porque as unidades também são gastas
 * pelos outros endpoints, que não consomem vídeos nenhuns.
 *
 * OS DOIS TECTOS NÃO CONTAM DA MESMA MANEIRA — medido a 29/07, e é a parte que interessa:
 * duas corridas seguidas de `todos`, cada uma a pedir ~1.300 vídeos, gastaram 314 unidades
 * cada mas deixaram os vídeos únicos parados nos 81.136. As UNIDADES são cobradas por vídeo
 * devolvido, sempre; os VÍDEOS ÚNICOS só contam a primeira vez que se vê cada vídeo no mês.
 *
 * A consequência prática é o contrário do que parece: repetir a mesma varredura é barato no
 * tecto dos vídeos e caro no das unidades. Quem gasta vídeos únicos é a descoberta de
 * conteúdo NOVO — janelas novas, territórios novos, keywords novas — que é exactamente o que
 * o motor faz todos os dias com a janela deslizante. Por isso o guard existe, mesmo que não
 * seja ele a bloquear no dia a dia.
 *
 * O piso é proporcionalmente mais alto que o das unidades (5% contra 2%) porque o recurso é
 * dez vezes mais escasso e uma corrida mínima consome centenas de vídeos de uma vez.
 */
export const PISO_VIDEOS = Number(process.env.TUBULAR_VIDEO_FLOOR) || 5000;

/** Custo estimado por unidade de trabalho, medido a 28/07/2026. */
export const CUSTO = {
  video_search: 1,        // por vídeo pedido (scroll_size)
  monthly_trends: 0.1,    // por creator
  trends: 36,             // por creator (2 plataformas, ~90 dias)
  summary: 20,            // por linha-plataforma
  creator_search: 40,     // por creator devolvido
};

/**
 * Lê os cabeçalhos de quota de uma resposta e regista o saldo.
 *
 * Chamar em TODA a resposta da Tubular — é de graça (a informação já veio no cabeçalho) e é
 * a única forma de o saldo ficar conhecido sem gastar uma chamada só para o consultar. Ao
 * contrário do influencers.club, a Tubular não tem endpoint de saldo: o saldo só se sabe
 * gastando, portanto não se pode perder a leitura que vem embrulhada no trabalho real.
 */
// última leitura de vídeos únicos vista neste processo — só o v3 a traz (ver abaixo)
let ultimoVideo = null;

export async function registarResposta(res, origem) {
  // `headers.get()` devolve null quando o cabeçalho falta — e `Number(null)` é 0, que passa
  // o Number.isFinite. Uma resposta sem cabeçalhos de quota gravava então `saldo: 0`, o guard
  // fechava sobre esse zero e a descoberta ficava morta até alguém editar a linha à mão.
  // Aconteceu a 29/07 com a quota real nas 199.742 unidades: a rota respondia
  // "0 unidades disponíveis" a tudo. É o impasse permanente que o resto do módulo se dá ao
  // trabalho de evitar, entrado pela porta das traseiras. `Number("")` é 0 pela mesma razão,
  // por isso o cabeçalho vazio também tem de cair antes da conversão.
  const num = (h) => {
    const bruto = res.headers.get(h);
    if (bruto == null || String(bruto).trim() === "") return null;
    const v = Number(bruto);
    return Number.isFinite(v) ? v : null;
  };
  const saldo = num("tubular-quota-units-remaining");
  if (saldo == null) return null;

  // O v3 e o v4 NÃO usam os mesmos nomes (comparado lado a lado a 29/07):
  //   gasto:        v3 `units-used`      · v4 `units-consumed`
  //   expiração:    v3 ausente           · v4 `units-expires-after`
  //   concorrência: v3 `ratelimit-concurrency-limit` · v4 `concurrencylimit`
  // Só `units-remaining` e `units-limit` são comuns. Ler só os nomes do v4 dava telemetria
  // vazia em metade das chamadas — e a descoberta corre quase toda em v3.
  //
  // O v3 expõe ainda um segundo tecto que não existe no v4 e que ninguém lia: um limite de
  // VÍDEOS ÚNICOS por mês (100.000; a 29/07 restavam 81.148, a expirar a 31/07). A descoberta
  // é o maior consumidor de vídeos únicos da app, portanto é o tecto que ela pode furar
  // primeiro — antes das unidades, que estão nas 199 mil.
  // Só o v3 traz os cabeçalhos de vídeos únicos. Uma corrida faz video.search (v3) e depois
  // monthly_trends (v4): sem memorizar, as chamadas v4 do fim gravavam `videos: null` por
  // cima da leitura boa que o v3 tinha acabado de dar, e o guard ficava cego logo a seguir
  // a ter enxergado. Guarda-se a última leitura conhecida e reescreve-se sempre.
  const vRest = num("tubular-ratelimit-uniquevideolimit-remaining");
  if (vRest != null) {
    ultimoVideo = {
      restantes: vRest,
      limite: num("tubular-ratelimit-uniquevideolimit-limit"),
      expira: res.headers.get("tubular-ratelimit-uniquevideolimit-expiresafter"),
    };
  }

  // Uma instância que só fez chamadas v4 (a Descoberta B, o monthly_trends do enrich) nunca
  // viu o cabeçalho dos vídeos únicos: `ultimoVideo` é null e o upsert gravava `videos: null`
  // por cima da leitura boa que outra instância tinha deixado. Aconteceu a 04/09/2026, com
  // o teto de vídeos esgotado (929 restantes): a B correu em produção e o estado ficou sem
  // leitura — e sem leitura o guard AUTORIZA, portanto o cron das 05:00 pagaria a primeira
  // página de video.search contra um teto fechado. Sem leitura própria, herda-se a gravada,
  // desde que seja deste mês (o teto repõe a 1).
  if (!ultimoVideo) {
    try {
      const { data } = await supabaseAdmin().from("sweep_state").select("value").eq("key", STATE_KEY).maybeSingle();
      const v = data?.value?.videos;
      if (v && Number.isFinite(Number(v.restantes)) && String(v.expira ?? "").slice(0, 7) >= new Date().toISOString().slice(0, 7)) ultimoVideo = v;
    } catch { /* sem leitura herdada: fica null, como antes */ }
  }

  const info = {
    saldo,
    limite: num("tubular-quota-units-limit"),
    gasto_nesta: num("tubular-quota-units-consumed") ?? num("tubular-quota-units-used"),
    expira: res.headers.get("tubular-quota-units-expires-after"),
    videos: ultimoVideo,
    origem,
    visto_em: new Date().toISOString(),
  };
  try {
    await supabaseAdmin().from("sweep_state").upsert(
      { key: STATE_KEY, value: info, updated_at: info.visto_em },
      { onConflict: "key" }
    );
  } catch { /* telemetria nunca derruba a chamada que a produziu */ }
  return info;
}

/** Último saldo conhecido, com a idade da leitura. */
export async function saldoConhecido() {
  try {
    const { data } = await supabaseAdmin().from("sweep_state").select("value").eq("key", STATE_KEY).maybeSingle();
    const v = data?.value;
    if (!v || !Number.isFinite(Number(v.saldo))) return null;

    // Leitura de um mês anterior é leitura MORTA — e descartá-la aqui não é higiene, é o que
    // impede um impasse permanente. A quota repõe a 1 de cada mês, mas só se conhece gastando,
    // e o único escritor desta chave é o tubularFetch, que corre DEPOIS do guard. Um saldo
    // baixo gravado a 31/07 recusaria a corrida de 01/08 — a única capaz de o actualizar — e
    // a descoberta ficava morta até alguém editar a linha à mão.
    //
    // Cruza `expira` com `visto_em` de propósito: se o cabeçalho de expiração faltar numa
    // resposta, `expira` fica null e sozinho nunca dispararia o descarte.
    const mesActual = new Date().toISOString().slice(0, 7);
    const mesLeitura = String(v.expira ?? v.visto_em ?? "").slice(0, 7);
    if (mesLeitura && mesLeitura < mesActual) return null;

    const idadeMin = v.visto_em ? Math.round((Date.now() - new Date(v.visto_em)) / 60000) : null;
    return { ...v, saldo: Number(v.saldo), idade_min: idadeMin };
  } catch { return null; }
}

/**
 * Autoriza (ou não) gastar `custo` unidades.
 *
 * Sem leitura anterior, autoriza — mas só porque a primeira chamada é justamente o que
 * produz a leitura, e recusá-la deixaria o sistema num impasse permanente (a Tubular não
 * tem endpoint de saldo gratuito). Daí em diante há sempre saldo conhecido.
 *
 * `expira` é informativo mas importante: a quota é mensal e não transita. Saldo que sobra
 * a 31 evapora-se, e é isso que justifica varrer mais no fim do mês em vez de poupar.
 */
export async function podeGastar(custo, { nome = "tubular", videos = 0 } = {}) {
  const ult = saldoMem?.saldo != null ? { ...saldoMem, idade_min: 0 } : await saldoConhecido();
  if (!ult) {
    return { ok: true, saldo: null, motivo: "sem leitura anterior — a primeira chamada estabelece o saldo" };
  }

  if (ult.saldo - custo < PISO) {
    return {
      ok: false, saldo: ult.saldo, expira: ult.expira, videos: ult.videos ?? ultimoVideo,
      motivo: `piso de quota da Tubular: ${Math.round(ult.saldo)} unidades disponíveis, ${nome} custa ~${Math.round(custo)}, piso ${PISO}. A quota repõe no início do mês (${ult.expira ?? "?"}).`,
    };
  }

  // Segundo tecto, verificado a seguir e não em vez do primeiro: os dois são independentes e
  // a varredura pode furar qualquer um deles. Só bloqueia com leitura conhecida — sem ela o
  // v3 ainda não respondeu e recusar seria o mesmo impasse que o piso das unidades evita.
  const vid = ult.videos ?? ultimoVideo;
  if (videos > 0 && Number.isFinite(Number(vid?.restantes)) && vid.restantes - videos < PISO_VIDEOS) {
    return {
      ok: false, saldo: ult.saldo, expira: ult.expira, videos: vid,
      motivo: `piso de VÍDEOS ÚNICOS da Tubular: ${Math.round(vid.restantes)} disponíveis, ${nome} pede ~${Math.round(videos)}, piso ${PISO_VIDEOS}. Este tecto é mensal e independente das unidades (expira ${vid.expira ?? "?"}), e é o que uma varredura fura primeiro.`,
    };
  }

  return { ok: true, saldo: ult.saldo, expira: ult.expira, videos: vid, idade_min: ult.idade_min };
}

/** Quantas unidades de trabalho cabem sem furar o piso. */
export function cabemNoOrcamento(saldo, custoUnitario, pedidos) {
  if (!Number.isFinite(saldo) || !custoUnitario) return pedidos;
  return Math.max(0, Math.min(pedidos, Math.floor((saldo - PISO) / custoUnitario)));
}

/**
 * Custo estimado de uma chamada, a partir do endpoint e do corpo.
 *
 * Sobrestima de propósito: para o creator.search a Tubular cobra por LINHA DEVOLVIDA, que
 * não se sabe antes de a pedir, portanto conta-se o tamanho pedido. Num guard, errar por
 * excesso pára cedo de mais; errar por defeito é o que esvazia a quota.
 */
export function estimarVideos(endpoint, body = {}) {
  // Só o video.search consome vídeos únicos — os endpoints de creator não tocam no tecto.
  if (!endpoint.includes("video.search")) return 0;
  return body?.scroll?.scroll_size ?? body?.scroll?.size ?? 100;
}

export function estimarCusto(endpoint, body = {}) {
  const ids = body?.include?.ids?.length ?? body?.ids?.length ?? 0;
  const scroll = body?.scroll?.scroll_size ?? body?.scroll?.size ?? 100;
  if (endpoint.includes("video.search")) return scroll * CUSTO.video_search;
  if (endpoint.includes("monthly_trends")) return Math.max(ids, 1) * CUSTO.monthly_trends;
  if (endpoint.includes("creator.trends")) return Math.max(ids, 1) * CUSTO.trends;
  if (endpoint.includes("creator.summary")) return Math.max(ids, 1) * CUSTO.summary;
  if (endpoint.includes("creator.search")) {
    // v4, medido a 04/09/2026: 5 por linha só com ids e cada grupo de `fields` soma o seu
    // (snippet 5, account_snippet 5, performance 10, account_performance 10; taxonomy 20
    // pela doc; o resto — demografia — assume-se a 20). Sem `scroll.size` o v4 devolve 50
    // por página, não 100. O antigo 40 fixo era o custo de snippet+performance+taxonomy e
    // sobrestimava 8× a listagem só de ids da descoberta por perfil.
    const CUSTO_FIELD = { snippet: 5, account_snippet: 5, performance: 10, account_performance: 10, monthly_performance: 10, account_monthly_performance: 10, taxonomy: 20 };
    const fields = Object.entries(body?.fields ?? {}).filter(([, v]) => v === true).map(([k]) => k);
    const porLinha = 5 + fields.reduce((s, k) => s + (CUSTO_FIELD[k] ?? 20), 0);
    const linhas = ids || body?.scroll?.size || 50;
    return Math.max(linhas, 1) * porLinha;
  }
  return 100; // endpoint desconhecido: assume o custo de uma página típica
}

/**
 * Chamada à Tubular com serialização GLOBAL e registo de quota.
 *
 * O `lib/tubular.js` serializa a 1,1 s, mas por instância de função — em serverless, cron,
 * botão e cadeia de enrich correm em instâncias diferentes e violam trivialmente o
 * `tubular-concurrencylimit: 1`. Já existe um prospect com status `erro tubular 429` na base.
 * Aqui a fila é do módulo e o intervalo é maior, e quem quiser paralelismo real tem de
 * passar por um lock em `sweep_state`, não por mais instâncias.
 */
const INTERVALO_MS = 1300;
let ultima = 0;
let fila = Promise.resolve();

// Saldo em memória, alimentado pelos cabeçalhos de cada resposta. Evita uma leitura ao
// Supabase por chamada num ciclo de varredura, e é sempre mais fresco do que o que está
// gravado — o gravado serve para o arranque a frio e para as outras instâncias.
let saldoMem = null;

export function tubularFetch(endpoint, body, { origem = "?", semGuard = false } = {}) {
  const minha = fila.then(async () => {
    // PISO ANTES DA CHAMADA, aqui dentro e não só nos chamadores. Era esse o buraco: o guard
    // vivia no discover-tubular, e o tubular-sync, o tubular-backfill, o promote, o evaluate
    // e o /api/discover continuavam a gastar sem medir nem verificar nada — incluindo o
    // creator.search, a 40 unidades por creator. Estando aqui, cobre todos de uma vez.
    if (!semGuard) {
      const custo = estimarCusto(endpoint, body);
      const gravado = saldoMem?.saldo == null ? await saldoConhecido() : null;
      const saldo = saldoMem?.saldo ?? gravado?.saldo ?? null;
      if (saldo != null && saldo - custo < PISO) {
        const e = new Error(`Tubular ${endpoint}: piso de quota (${Math.round(saldo)} unidades, custo ~${Math.round(custo)}, piso ${PISO}). A quota repõe no início do mês.`);
        e.quotaBloqueada = true;
        throw e;
      }

      // Segundo tecto: vídeos únicos. Independente do das unidades e mais apertado — 100 mil
      // por mês contra 1 milhão — e é o que uma varredura fura primeiro. Só o video.search
      // lhe toca, e só o v3 o reporta, portanto `ultimoVideo` é a leitura de referência.
      const pedidos = estimarVideos(endpoint, body);
      const vid = ultimoVideo ?? gravado?.videos ?? null;
      if (pedidos > 0 && Number.isFinite(Number(vid?.restantes)) && vid.restantes - pedidos < PISO_VIDEOS) {
        const e = new Error(`Tubular ${endpoint}: piso de vídeos únicos (${Math.round(vid.restantes)} disponíveis, pedidos ~${pedidos}, piso ${PISO_VIDEOS}). Tecto mensal independente das unidades, expira ${vid.expira ?? "?"}.`);
        e.quotaBloqueada = true;
        throw e;
      }
    }

    const espera = Math.max(0, ultima + INTERVALO_MS - Date.now());
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultima = Date.now();
    const res = await fetch(`https://tubularlabs.com/api${endpoint}`, {
      method: "POST",
      headers: { "Api-Key": process.env.TUBULAR_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    const quota = await registarResposta(res, origem);
    if (quota) saldoMem = { saldo: quota.saldo, expira: quota.expira, videos: quota.videos };
    const txt = await res.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* corpo não-JSON cai no erro abaixo */ }
    if (!res.ok) {
      const e = new Error(`Tubular ${endpoint} ${res.status}: ${txt.slice(0, 250)}`);
      e.status = res.status;
      e.quota = quota;
      throw e;
    }
    return { json, quota };
  });
  fila = minha.catch(() => undefined);
  return minha;
}
