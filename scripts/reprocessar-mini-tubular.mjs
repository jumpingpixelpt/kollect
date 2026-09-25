#!/usr/bin/env node
// Passo 2 — re-graduar os prospects PARTIDOS de fonte=tubular.
//
// Contexto: ~3.035 prospects vieram de um creator.search (têm tubular_id + name)
// mas nunca receberam as stats por-perfil — followers/eng/growth a null, logo sem
// mini_score útil. Este script vai buscar essas stats por lotes a
// /v4/creator.monthly_trends (0,1 unidade/creator — o endpoint mais barato da
// Tubular) e recalcula o funnelMiniScore, exatamente como o discover-tubular faz.
//
// NÃO promove ninguém: só preenche a linha de descoberta (prospects). A promoção
// a creator é outro caminho (promote-apify/enrich).
//
// Segurança:
//   - corre em DRY-RUN por omissão; escreve só com --go.
//   - respeita o piso de quota (PISO unidades) lido dos headers da Tubular.
//   - throttle de 1,2 s entre chamadas (concorrência 1 do lado da Tubular).
//   - --limit N para testar num subconjunto.
//
// Uso:
//   node scripts/reprocessar-mini-tubular.mjs            # dry-run, mostra o que faria
//   node scripts/reprocessar-mini-tubular.mjs --go       # escreve
//   node scripts/reprocessar-mini-tubular.mjs --go --limit 100
//
// Lê TUBULAR_API_KEY e SUPABASE_SERVICE_ROLE_KEY de .env.local.

import { readFileSync } from "node:fs";

// ── env ────────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TUBULAR_KEY = process.env.TUBULAR_API_KEY;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA = "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!TUBULAR_KEY || !SR) { console.error("Falta TUBULAR_API_KEY ou SUPABASE_SERVICE_ROLE_KEY em .env.local"); process.exit(1); }

const GO = process.argv.includes("--go");
const SO_RADAR = process.argv.includes("--so-radar"); // saltar quem gradua fora de IG/TikTok
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? Number(process.argv[i + 1]) : Infinity; })();
const PISO = Number(process.env.TUBULAR_UNIT_FLOOR) || 20000; // não gastar abaixo disto
const LOTE = 50;        // discover-tubular usa 50; num lote de 100 vinham só 50 resultados
const THROTTLE = 1200;  // ms entre chamadas Tubular

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── funnelMiniScore (cópia fiel de lib/score.js) ─────────────────────────────
function funnelMiniScore({ engPct, followers, growthPct }) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const eng = clamp((Number(engPct) || 0) * 3, 0, 30);
  const f = Number(followers) || 0;
  const size = f >= 10000 && f <= 300000 ? 30 : f >= 3000 && f < 10000 ? 18 : 8;
  const growth = growthPct == null ? 0 : clamp(Number(growthPct) * 8, 0, 40);
  return Math.round((eng + size + growth) * 10) / 10;
}

// ── Supabase REST ────────────────────────────────────────────────────────────
const sHeaders = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

async function fetchPartidos() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPA}/rest/v1/prospects?select=tubular_id,platform,name`
      + `&fonte=eq.tubular&followers=is.null&status=eq.novo&tubular_id=not.is.null`
      + `&order=tubular_id&limit=1000&offset=${offset}`;
    const r = await fetch(url, { headers: sHeaders });
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
    if (out.length >= LIMIT) break;
  }
  return out.slice(0, LIMIT === Infinity ? out.length : LIMIT);
}

async function patchProspect(tid, patch) {
  const r = await fetch(`${SUPA}/rest/v1/prospects?tubular_id=eq.${encodeURIComponent(tid)}`, {
    method: "PATCH", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH ${tid}: ${r.status} ${(await r.text()).slice(0, 120)}`);
}

// ── Tubular ──────────────────────────────────────────────────────────────────
let unitsRemaining = Infinity;
async function tubularTrends(ids) {
  await sleep(THROTTLE);
  const r = await fetch("https://tubularlabs.com/api/v4/creator.monthly_trends", {
    method: "POST",
    headers: { "Api-Key": TUBULAR_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ include: { ids } }),
  });
  const rem = Number(r.headers.get("tubular-quota-units-remaining"));
  if (Number.isFinite(rem)) unitsRemaining = rem;
  if (!r.ok) throw new Error(`Tubular ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// escolhe a série da plataforma do prospect; se não houver, a de mais followers
function escolherPlataforma(trends, platformPref) {
  const plats = [...new Set(trends.map((t) => t.platform).filter(Boolean))];
  if (platformPref && plats.includes(platformPref)) return platformPref;
  let best = null, bestF = -1;
  for (const p of plats) {
    const serie = trends.filter((t) => t.platform === p);
    const ult = serie[serie.length - 1];
    const f = Number(ult?.followers?.all_time) || 0;
    if (f > bestF) { bestF = f; best = p; }
  }
  return best;
}

function graduar(trends, platform) {
  const daPlat = trends.filter((t) => t.platform === platform)
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (!daPlat.length) return null;
  const ult = daPlat[daPlat.length - 1];
  const followers = Number(ult?.followers?.all_time) || 0;
  const mesCorrente = new Date().toISOString().slice(0, 7);
  const fechados = daPlat.filter((t) => String(t.month) < mesCorrente);
  const ultF = fechados[fechados.length - 1];
  const penF = fechados[fechados.length - 2];
  const f1 = Number(ultF?.followers?.all_time) || 0;
  const f0 = Number(penF?.followers?.all_time) || 0;
  const growthPct = f0 > 0 && f1 > 0 ? ((f1 - f0) / f0) * 100
    : (ultF?.followers?.month_over_month != null ? Number(ultF.followers.month_over_month) * 100 : null);
  const engPct = ult?.aggregated?.engagement_rate != null ? Number(ult.aggregated.engagement_rate) : null;
  const views30 = ult?.aggregated?.views_30_days != null ? Number(ult.aggregated.views_30_days) : null;
  return {
    platform, followers,
    growth_30: growthPct != null ? Math.round(growthPct * 100) / 100 : null,
    eng_rate: engPct != null ? Math.round(engPct * 100) / 100 : null,
    views_total: views30 ?? null,
    mini_score: funnelMiniScore({ engPct: engPct ?? 0, followers, growthPct }),
  };
}

// ── run ──────────────────────────────────────────────────────────────────────
const alvos = await fetchPartidos();
console.log(`Partidos a reprocessar: ${alvos.length}  (modo: ${GO ? "ESCREVE" : "DRY-RUN"})`);
const byId = new Map(alvos.map((p) => [p.tubular_id, p]));

let ok = 0, semSerie = 0, semFollowers = 0, foraRadar = 0, chamadas = 0;
const amostra = [];

for (let i = 0; i < alvos.length; i += LOTE) {
  if (unitsRemaining < PISO) { console.log(`⛔ quota abaixo do piso (${unitsRemaining} < ${PISO}) — parado`); break; }
  const lote = alvos.slice(i, i + LOTE).map((p) => p.tubular_id);
  let json;
  try { json = await tubularTrends(lote); chamadas++; }
  catch (e) { console.error(`lote ${i}: ${e.message}`); break; }

  for (const res of json?.results ?? []) {
    const cid = res.creator?.id; if (!cid) continue;
    const prospect = byId.get(cid); if (!prospect) continue;
    const trends = res.trends ?? [];
    const plat = escolherPlataforma(trends, prospect.platform);
    const g = plat ? graduar(trends, plat) : null;
    if (!g) { semSerie++; if (GO) await patchProspect(cid, { status: "tubular:sem_serie" }).catch(() => {}); continue; }
    if (SO_RADAR && plat !== "instagram" && plat !== "tiktok") {
      foraRadar++; if (GO) await patchProspect(cid, { platform: plat, status: `tubular:fora_radar_${plat}` }).catch(() => {}); continue;
    }
    if (!g.followers) { semFollowers++; continue; }
    const patch = {
      followers: g.followers, eng_rate: g.eng_rate, growth_30: g.growth_30,
      views_total: g.views_total, mini_score: g.mini_score, platform: g.platform,
      status: "tubular:reprocessado",
    };
    if (amostra.length < 8) amostra.push({ tid: cid, ...patch });
    if (GO) { try { await patchProspect(cid, patch); ok++; } catch (e) { console.error(e.message); } }
    else ok++;
  }
  process.stdout.write(`\r  lote ${i / LOTE + 1} · ok ${ok} · fora-radar ${foraRadar} · sem-série ${semSerie} · quota ${Math.round(unitsRemaining)}   `);
}

console.log(`\n\n${GO ? "Gravados" : "Graduáveis (dry-run)"}: ${ok}  ·  fora do radar (FB/YT): ${foraRadar}  ·  sem série: ${semSerie}  ·  sem followers: ${semFollowers}  ·  chamadas Tubular: ${chamadas}  ·  quota restante: ${Math.round(unitsRemaining)}`);
if (!GO) { console.log("\nAmostra do que seria escrito:"); console.table(amostra); console.log("\nCorre com --go para gravar."); }
