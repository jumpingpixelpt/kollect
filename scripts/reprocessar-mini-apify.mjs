#!/usr/bin/env node
// Passo 3 — re-graduar os prospects PARTIDOS de fontes sem tubular_id, via Apify.
//
// São ~184: csv-liso (TikTok), caption-ig / hashtag-caption / xlsx-elseve (IG/TT).
// Todos têm handle + plataforma, mas sem followers/eng — logo sem mini_score útil.
// Este script raspa o perfil no Apify (mesmos atores que o promote-*) e recalcula
// o funnelMiniScore. NÃO promove a creator: só preenche a linha de descoberta.
//
// ⚠️ Precisa de APIFY_TOKEN. NÃO está em .env.local (só existe na Vercel). Antes de
//    correr, exporta-o:  export APIFY_TOKEN=apify_api_...
//    (ou acrescenta a linha ao .env.local).
//
// Apify run-sync é lento (10-60 s por perfil) e sequencial → ~184 perfis podem
// levar 30 min a 2 h. Usa --limit para testar. DRY-RUN por omissão; --go escreve.
//
// Uso:
//   export APIFY_TOKEN=apify_api_...
//   node scripts/reprocessar-mini-apify.mjs --limit 5      # dry-run, 5 perfis
//   node scripts/reprocessar-mini-apify.mjs --go           # escreve, todos

import { readFileSync } from "node:fs";

// ── env ────────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const APIFY = process.env.APIFY_TOKEN;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA = "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!APIFY) { console.error("Falta APIFY_TOKEN (não está em .env.local — exporta-o: export APIFY_TOKEN=...)"); process.exit(1); }
if (!SR) { console.error("Falta SUPABASE_SERVICE_ROLE_KEY em .env.local"); process.exit(1); }

const GO = process.argv.includes("--go");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? Number(process.argv[i + 1]) : Infinity; })();

const sum = (a) => a.reduce((x, y) => x + y, 0);

// ── funnelMiniScore + engRateViews (cópias fiéis de lib/) ────────────────────
function funnelMiniScore({ engPct, followers, growthPct }) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const eng = clamp((Number(engPct) || 0) * 3, 0, 30);
  const f = Number(followers) || 0;
  const size = f >= 10000 && f <= 300000 ? 30 : f >= 3000 && f < 10000 ? 18 : 8;
  const growth = growthPct == null ? 0 : clamp(Number(growthPct) * 8, 0, 40);
  return Math.round((eng + size + growth) * 10) / 10;
}
function engRateViews(engagements, views) {           // devolve % (eng/views*100)
  const e = Number(engagements), v = Number(views);
  if (!Number.isFinite(e) || !Number.isFinite(v) || v <= 0 || e < 0) return null;
  return Math.round((e / v) * 10000) / 100;
}

// ── Supabase REST ────────────────────────────────────────────────────────────
const sHeaders = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

async function fetchPartidos() {
  const url = `${SUPA}/rest/v1/prospects?select=tubular_id,handle,platform,name,fonte`
    + `&followers=is.null&handle=not.is.null&fonte=neq.tubular`
    + `&platform=in.(instagram,tiktok)&status=neq.promovido&order=fonte&limit=1000`;
  const r = await fetch(url, { headers: sHeaders });
  const rows = await r.json();
  return rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT);
}
async function patchProspect(tid, patch) {
  const r = await fetch(`${SUPA}/rest/v1/prospects?tubular_id=eq.${encodeURIComponent(tid)}`, {
    method: "PATCH", headers: { ...sHeaders, Prefer: "return=minimal" }, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH ${tid}: ${r.status} ${(await r.text()).slice(0, 120)}`);
}

// ── Apify ─────────────────────────────────────────────────────────────────────
async function apify(actor, input, timeout = 150) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout * 1000 + 20000) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return Array.isArray(j) ? j : [];
}

// Instagram — apify~instagram-profile-scraper (igual ao promote-apify)
async function statsInstagram(handle) {
  const items = await apify("apify~instagram-profile-scraper", { usernames: [handle] }, 150);
  const p = items[0];
  if (!p?.followersCount) return null;
  const posts = (p.latestPosts || []).slice(0, 12);
  const views = posts.map((v) => v.videoViewCount ?? v.videoPlayCount ?? 0).filter(Boolean);
  const likes = sum(posts.map((v) => v.likesCount ?? 0));
  const comments = sum(posts.map((v) => v.commentsCount ?? 0));
  return { followers: p.followersCount, eng: engRateViews(likes + comments, sum(views)) };
}

// TikTok — clockworks~tiktok-scraper (igual ao promote-tiktok)
async function statsTiktok(handle) {
  const items = await apify("clockworks~tiktok-scraper",
    { profiles: [handle], resultsPerPage: 15, shouldDownloadVideos: false, shouldDownloadCovers: false }, 150);
  if (!items.length) return null;
  const am = items[0].authorMeta || {};
  const followers = am.fans ?? am.followers ?? null;
  if (!followers) return null;
  const views = items.map((v) => Number(v.playCount) || 0).filter(Boolean);
  const eng = sum(items.map((v) => (Number(v.diggCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0)));
  return { followers, eng: engRateViews(eng, sum(views)) };
}

// ── run ──────────────────────────────────────────────────────────────────────
const alvos = await fetchPartidos();
console.log(`Partidos (Apify) a reprocessar: ${alvos.length}  (modo: ${GO ? "ESCREVE" : "DRY-RUN"})`);

let ok = 0, falhou = 0;
const amostra = [];
for (const [n, p] of alvos.entries()) {
  process.stdout.write(`\r  [${n + 1}/${alvos.length}] @${p.handle} (${p.platform})            `);
  let s = null;
  try { s = p.platform === "tiktok" ? await statsTiktok(p.handle) : await statsInstagram(p.handle); }
  catch (e) { falhou++; console.error(`\n  @${p.handle}: ${e.message}`); continue; }
  if (!s) { falhou++; if (GO) await patchProspect(p.tubular_id, { status: `${p.platform}:apify_vazio` }).catch(() => {}); continue; }

  const mini = funnelMiniScore({ engPct: s.eng ?? 0, followers: s.followers, growthPct: null });
  const patch = { followers: s.followers, eng_rate: s.eng, mini_score: mini, status: `${p.platform}:apify_reprocessado` };
  if (amostra.length < 8) amostra.push({ handle: p.handle, plat: p.platform, ...patch });
  if (GO) { try { await patchProspect(p.tubular_id, patch); ok++; } catch (e) { console.error(`\n  ${e.message}`); falhou++; } }
  else ok++;
}

console.log(`\n\n${GO ? "Gravados" : "Graduáveis (dry-run)"}: ${ok}  ·  falhou/vazio: ${falhou}`);
if (!GO) { console.log("\nAmostra do que seria escrito:"); console.table(amostra); console.log("\nCorre com --go para gravar (e com APIFY_TOKEN exportado)."); }
