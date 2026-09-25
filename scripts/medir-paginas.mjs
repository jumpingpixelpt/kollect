// Somente leitura: node scripts/medir-paginas.mjs
// Usa .env.local sem imprimir valores. Saída: tempos, totais, bytes e divergências.
// Não cria sessões nem chama pipelines. Tempos são locais, sem cache de página,
// e bytes medem JSON normalizado; esta medição não representa o site inteiro.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { fetchPageRows, fetchPageIds, fetchPageCounts, fetchCreatorLatestMetrics, fetchCampaignCreatorClasses } from "../lib/page-data.js";
import { classeDe, roleDe, tagDe, tagDaFicha, contaNoCasting, PAPEL_LABEL } from "../lib/casting.js";
import { fetchCreatorDetail } from "../lib/creator-detail.js";
import { fetchCampaignDetail } from "../lib/campaign-detail.js";

const require = createRequire(import.meta.url);
let step = "configuração", requests = 0, mismatchTotal = 0;
const print = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const unique = (values) => [...new Set(values.filter(Boolean))];
const fail = () => { throw new Error("Leitura não concluída"); };
async function measure(name, read, totals = () => ({})) {
  step = name;
  const before = requests, start = performance.now();
  const data = await read();
  print({ medicao: name, ms: Math.round(performance.now() - start), requests: requests - before,
    jsonBytes: Buffer.byteLength(JSON.stringify(data)), ...totals(data) });
  return data;
}
function check(name, comparisons) {
  const fields = {};
  for (const [field, before, after] of comparisons) {
    if (!isDeepStrictEqual(before, after)) fields[field] = (fields[field] || 0) + 1;
  }
  const n = Object.values(fields).reduce((sum, value) => sum + value, 0);
  mismatchTotal += n;
  print({ verificacao: name, comparacoes: comparisons.length, mismatches: n, campos: fields });
}
async function exact(q) {
  const { count, error } = await q;
  if (error || !Number.isInteger(count)) fail();
  return count;
}
async function oldPanel(db, today) {
  const P = () => db.from("prospects").select("tubular_id", { count: "exact", head: true });
  const C = () => db.from("creators").select("id", { count: "exact", head: true });
  const visible = (q) => q.not("status", "like", "sem_handle:irrecuperavel%");
  const funnel = (q) => visible(q.neq("status", "substituida_ic").neq("status", "promovido"));
  const [universo, qualificadas, comGrowth, noRadar, crows, fontes, funilCounts, termos] = await Promise.all([
    exact(P()), exact(P().gte("mini_score", 50)), exact(P().not("growth_30", "is", null)), exact(C()),
    // Completa a leitura antiga: não comparar a RPC com apenas 1.000 linhas.
    fetchPageRows(() => db.from("creators")
      .select("classe:kol_score->geral->>classe,elegivel:kol_score->geral->>elegivel").order("id")),
    fetchPageRows(() => db.from("prospect_fontes").select("fonte,n,ultima_descoberta")
      .order("n", { ascending: false }).order("fonte")),
    Promise.all([exact(visible(P())), exact(C()),
      exact(funnel(P().gte("descoberto_em", today))), exact(funnel(P()))]),
    fetchPageRows(() => db.from("prospect_termos").select("termo,n")
      .order("n", { ascending: false }).order("termo")),
  ]);
  const [funilUniverso, comAnalise, deHoje, noFunil] = funilCounts;
  return { universo, qualificadas, comGrowth, noRadar, crows, fontes,
    funil: { universo: funilUniverso, comAnalise, deHoje, noFunil }, termos };
}
function summarizePanel(old) {
  const tag = { kol: "kol", rising_star: "rising_star", hidden_gem: "pool", brand_safe_performer: "pool", elegivel: "pool" };
  const classes = {};
  for (const row of old.crows) {
    const key = tag[row.classe] || (row.elegivel == null ? "sem_calculo" : "inelegivel");
    classes[key] = (classes[key] || 0) + 1;
  }
  return { termometro: { universo: old.universo, qualificadas: old.qualificadas,
    comGrowth: old.comGrowth, noRadar: old.noRadar, classes, fontes: old.fontes },
  funil: old.funil, termos: old.termos };
}
function latestMetrics(snapshots) {
  const result = new Map();
  for (const row of snapshots) {
    let item = result.get(row.creator_id);
    if (!item) {
      item = { creator_id: row.creator_id, captured_at: row.captured_at,
        avg_views: row.avg_views, eng_rate: row.eng_rate, last_avg_views: null, last_eng_rate: null };
      result.set(row.creator_id, item);
    }
    if (item.last_avg_views == null && row.avg_views != null) item.last_avg_views = row.avg_views;
    if (item.last_eng_rate == null && row.eng_rate != null) item.last_eng_rate = row.eng_rate;
  }
  return result;
}
function compareClasses(before, after) {
  const oldBy = new Map(before.map((c) => [c.id, c])), newBy = new Map(after.map((c) => [c.id, c]));
  const comparisons = [], helpers = { classeDe, roleDe, tagDe, contaNoCasting };
  // Variantes em memória: dois ramos, todos os papéis e inclusão manual.
  for (const id of unique([...oldBy.keys(), ...newBy.keys()])) {
    const old = oldBy.get(id), next = newBy.get(id);
    comparisons.push(["presenca", !!old, !!next], ["tagDaFicha", tagDaFicha(old), tagDaFicha(next)]);
    if (!old || !next) continue;
    for (const branch of ["geral", "masculino"]) for (const kind of [null, "kol", "rising", "manual"]) {
      for (const campaign_role of [null, ...Object.keys(PAPEL_LABEL)]) {
        const row = { kind, campaign_role };
        for (const [name, helper] of Object.entries(helpers)) {
          comparisons.push([name + ":" + branch + ":" + (kind === "manual" ? "manual" : "automatico"),
            helper(row, old, branch), helper(row, next, branch)]);
        }
      }
    }
  }
  check("classes-tags-casting-ramos-e-manual", comparisons);
}
async function main() {
  require("@next/env").loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), false, { info() {}, error() {} });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) fail();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
  const origin = new URL(url).origin;
  const tables = new Set(["prospects", "creators", "prospect_fontes", "prospect_termos",
    "campaign_creators", "list_creators", "snapshots", "leaderboard", "videos"]);
  const readRPCs = new Set(["painel_resumo", "page_counts", "creator_latest_metrics", "campaign_creator_classes"]);
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init = {}) => {
      const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
      const parts = target.pathname.split("/").filter(Boolean);
      const tableRead = ["GET", "HEAD"].includes(method) && parts.length === 3 && tables.has(parts[2]);
      const rpcRead = method === "POST" && parts.length === 4 && parts[2] === "rpc" && readRPCs.has(parts[3]);
      // Bloqueio explícito: nunca aceitar mutações ou rotas da aplicação.
      if (target.origin !== origin || parts[0] !== "rest" || parts[1] !== "v1" || (!tableRead && !rpcRead)) fail();
      requests++;
      return fetch(input, { ...init, cache: "no-store", signal: init.signal || AbortSignal.timeout(20000) });
    } },
  });
  const today = new Date().toISOString().slice(0, 10);
  const old = await measure("painel-antigo-completo", () => oldPanel(db, today), (r) => ({ creators: r.crows.length }));
  const next = await measure("painel-rpc", async () => {
    const { data, error } = await db.rpc("painel_resumo", { p_hoje: today });
    if (error || !data) fail();
    return data;
  }, (r) => ({ creators: r.termometro.noRadar }));
  const expected = summarizePanel(old);
  check("painel", ["termometro", "funil", "termos"].map((k) => [k, expected[k], next[k]]));

  const source = await measure("ids-de-castings-e-squads", async () => {
    const [campaigns, lists] = await Promise.all([
      fetchPageRows(() => db.from("campaign_creators")
        .select("campaign_id,creator_id,prospect_id,kind,campaign_role,status").order("id")),
      fetchPageRows(() => db.from("list_creators").select("list_id,creator_id,status").order("id")),
    ]);
    return { campaigns, lists };
  }, (r) => ({ campaignRows: r.campaigns.length, listRows: r.lists.length }));
  const creatorIds = unique([...source.campaigns, ...source.lists].map((r) => r.creator_id));
  print({ amostra: { creators: creatorIds.length,
    campaigns: unique(source.campaigns.map((r) => r.campaign_id)).length,
    lists: unique(source.lists.map((r) => r.list_id)).length } });
  if (!creatorIds.length) fail();
  const oldClasses = await measure("classes-jsons-completos", () => fetchPageIds((ids) => db.from("creators")
    .select("id,kol_score,kol_screen").in("id", ids).order("id"), creatorIds), (r) => ({ creators: r.length }));
  const newClasses = await measure("classes-rpc-compacta", () => fetchCampaignCreatorClasses(db, creatorIds),
    (r) => ({ creators: r.length }));
  compareClasses(oldClasses, newClasses);
  const oldSnapshots = await measure("metricas-historico-completo", () => fetchPageIds((ids) => db.from("snapshots")
    .select("id,creator_id,captured_at,avg_views,eng_rate").in("creator_id", ids)
    .order("captured_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }), creatorIds),
  (r) => ({ snapshots: r.length }));
  const metrics = await measure("metricas-rpc", () => fetchCreatorLatestMetrics(db, creatorIds),
    (r) => ({ creators: r.length }));
  const expectedMetrics = latestMetrics(oldSnapshots), actualMetrics = new Map(metrics.map((r) => [r.creator_id, r]));
  check("ultima-linha-e-ultima-metrica-nao-nula", unique([...expectedMetrics.keys(), ...actualMetrics.keys()])
    .map((id) => ["metricas", expectedMetrics.get(id), actualMetrics.get(id)]));

  const counts = await measure("contagens-rpc", () => fetchPageCounts(db, {
    campaignIds: unique(source.campaigns.map((r) => r.campaign_id)),
    listIds: unique(source.lists.map((r) => r.list_id)),
  }), (r) => ({ campaigns: r.campaigns.length, lists: r.lists.length }));
  const oldCampaignCounts = new Map(), oldListCounts = new Map();
  for (const row of source.campaigns) {
    const count = oldCampaignCounts.get(row.campaign_id) || { id: row.campaign_id, total: 0, kol: 0, rising: 0 };
    count.total++; if (row.kind === "kol") count.kol++; if (row.kind === "rising") count.rising++;
    oldCampaignCounts.set(row.campaign_id, count);
  }
  for (const row of source.lists) {
    const count = oldListCounts.get(row.list_id) || { id: row.list_id, total: 0, concluida: 0 };
    count.total++; if (row.status === "concluida") count.concluida++;
    oldListCounts.set(row.list_id, count);
  }
  check("contagens-por-lista", [
    ...counts.campaigns.map((r) => ["campaign", oldCampaignCounts.get(r.id), r]),
    ...counts.lists.map((r) => ["list", oldListCounts.get(r.id), r]),
    ["campaign-rows", oldCampaignCounts.size, counts.campaigns.length],
    ["list-rows", oldListCounts.size, counts.lists.length],
  ]);
  const groups = new Map();
  for (const row of source.campaigns) {
    if (!groups.has(row.campaign_id)) groups.set(row.campaign_id, []);
    groups.get(row.campaign_id).push(row);
  }
  const casting = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (casting?.length) await measure("smoke-fetchCampaignDetail", () => fetchCampaignDetail(db, casting), (r) => ({
    creators: r.creators.length, prospects: r.prospects.length,
    metricas: Object.keys(r.snapBy).length, contasIrmas: r.irmasAll.length,
  }));
  // Conta já pontuada, entre os IDs reais obtidos. Os gates de acesso da UI não
  // são simulados: este script administrativo verifica somente o transporte.
  step = "seleção-da-ficha";
  let profileId = null;
  for (let i = 0; i < creatorIds.length && !profileId; i += 150) {
    const { data, error } = await db.from("leaderboard").select("id")
      .in("id", creatorIds.slice(i, i + 150)).order("id").limit(1);
    if (error) fail();
    profileId = data?.[0]?.id;
  }
  if (!profileId) fail();
  await measure("smoke-fetchCreatorDetail", () => fetchCreatorDetail(db, profileId), (r) => ({
    perfis: r.c ? 1 : 0, contas: r.contas.length, snapshots: r.snaps.length,
    videos: r.videos.length, videosIrmas: r.vidsIrmas.length, campanhas: r.cc.length,
  }));
  print({ resultado: { mismatches: mismatchTotal } });
  if (mismatchTotal) process.exitCode = 1;
}
main().catch(() => {
  // Erros do fornecedor podem conter URLs, SQL ou dados: nunca imprimi-los.
  print({ erro: "Medição interrompida; detalhes de dados e credenciais omitidos", etapa: step });
  process.exitCode = 1;
});
