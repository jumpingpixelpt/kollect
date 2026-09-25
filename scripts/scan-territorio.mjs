#!/usr/bin/env node
// Corrida de análise para as creators SEM TERRITÓRIO por falta de análise.
//
// O território sai da leitura de conteúdo que o brand-scan escreve (brand_history.nichos).
// Quem nunca passou por ele fica sem classificação — e não é palpite de bio que resolve
// isso (ver scripts/classificar-territorio.mjs, que se recusa a inventá-lo).
//
// Nem todas estão no mesmo ponto, e é isso que este script separa:
//
//   scan      → tem vídeos na base: o brand-scan corre já.
//   importar  → não tem vídeos: /api/import-videos raspa os últimos posts no Apify e só
//               depois o brand-scan tem legendas para ler.
//
// A corrida de teste de 02/09 (5 creators) foi o que obrigou a existir a import-videos: o
// /api/evaluate parecia importar e não importava — o guardarVideos() dele só grava o que
// vem da Tubular, e para um creator só-Instagram corria sem erro e gravava ZERO (@victtoramori),
// com o brand-scan a responder "sem legendas" logo a seguir.
//
// Custos (preços Anthropic de jun/2026, claude-sonnet-4-6: $3/M entrada, $15/M saída):
// o brand-scan manda ~1,3k tokens de prompt + até 50 legendas (~3k tokens) e devolve
// ~1,5k → ~$0,036 por creator. O que pesa não é o Claude: é o Apify (uma raspagem de
// perfil por creator, 10-60 s cada) e o tempo de parede.
//
// DRY-RUN por omissão: sem --go só imprime o plano e a conta.
//
// Uso:
//   node scripts/scan-territorio.mjs                          # plano + custo
//   CRON_SECRET=… node scripts/scan-territorio.mjs --go       # corre (produção)
//   … --go --limit 10                                         # corre só as 10 primeiras
//   … --go --so-scan                                          # salta a importação Apify

import { readFileSync } from "node:fs";
import { territorioDe } from "../lib/territorio.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA = "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!SR) { console.error("Falta SUPABASE_SERVICE_ROLE_KEY em .env.local"); process.exit(1); }

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const GO = process.argv.includes("--go");
const SO_SCAN = process.argv.includes("--so-scan");
const LIMIT = Number(arg("--limit", Infinity));
const BASE = arg("--base", process.env.KOLLECT_BASE || "https://www.kollect.online");
const TOKEN = process.env.CRON_SECRET;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };

// preço por creator, em dólares (ver cabeçalho)
const USD_POR_SCAN = 0.036;

async function todas(path, campos) {
  const out = []; const passo = 1000;
  for (let de = 0; ; de += passo) {
    const r = await fetch(`${SUPA}/rest/v1/${path}?select=${campos}&order=id&offset=${de}&limit=${passo}`, { headers: H });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300));
    out.push(...j);
    if (j.length < passo) return out;
  }
}

console.log("A ler a base…");
const creators = await todas("creators", "id,handle,name,platform,tubular_id,bio,niche,category,brand_history,kol_screen,territorio");
const videos = await todas("videos", "creator_id,title");
const temVideo = new Set(videos.filter((v) => (v.title || "").trim()).map((v) => v.creator_id));

const alvo = [];
for (const c of creators) {
  const nichos = (c.brand_history?.nichos ?? []).map((n) => n.nicho).join(" ");
  const t = territorioDe({
    guardado: c.territorio,
    bucket: c.kol_screen?.metricas?.niche_bucket ?? null,
    textos: [nichos, c.niche, c.category],
    analisado: (c.brand_history?.nichos ?? []).length > 0,
  });
  if (t) continue;
  const temTub = c.tubular_id && !String(c.tubular_id).startsWith("ic_");
  alvo.push({ ...c, via: temTub ? "tubular" : temVideo.has(c.id) ? "banco" : "importar" });
}

const scan = alvo.filter((a) => a.via !== "importar");
const importar = alvo.filter((a) => a.via === "importar");
const porPlataforma = {};
for (const a of importar) porPlataforma[a.platform] = (porPlataforma[a.platform] || 0) + 1;

console.log(`\nsem território por falta de análise: ${alvo.length}`);
console.log(`  scan direto (tubular/banco): ${scan.length}`);
console.log(`  precisam de importar vídeos: ${importar.length}  [${Object.entries(porPlataforma).map(([p, n]) => `${p} ${n}`).join(", ")}]`);
console.log(`\nCUSTO`);
console.log(`  Claude (brand-scan, sonnet-4-6): ${alvo.length} × $${USD_POR_SCAN} ≈ $${(alvo.length * USD_POR_SCAN).toFixed(2)}`);
console.log(`  Apify: ${importar.length} raspagens de perfil — custo conforme o plano; 10-60 s cada`);
console.log(`  tempo de parede estimado: ${Math.round(importar.length * 35 / 60)}-${Math.round(importar.length * 60 / 60)} min só na importação`);

if (!GO) {
  console.log(`\nDRY-RUN. Corre com --go (e CRON_SECRET no ambiente) para executar.`);
  console.log("Amostra do que seria feito:");
  console.table(alvo.slice(0, 10).map((a) => ({ handle: a.handle, plataforma: a.platform, caminho: a.via })));
  process.exit(0);
}
if (!TOKEN) { console.error("\nFalta CRON_SECRET no ambiente — as rotas de /api respondem 401 sem sessão nem bearer."); process.exit(1); }

const chamar = async (rota) => {
  const r = await fetch(`${BASE}${rota}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { error: `resposta não-JSON (${r.status})` }; }
};

const fila = (SO_SCAN ? scan : [...scan, ...importar]).slice(0, LIMIT);
console.log(`\nA correr ${fila.length}…`);
let ok = 0, falhas = 0;
for (const [i, a] of fila.entries()) {
  if (a.via === "importar") {
    const imp = await chamar(`/api/import-videos?handle=${encodeURIComponent(a.handle)}`);
    if (imp.error || imp.fatal) { console.log(`  ✗ ${a.handle}: importação — ${String(imp.error || imp.fatal).slice(0, 90)}`); falhas++; continue; }
    // `saltado` não é falha: já tem peças de uma corrida anterior e o scan pode correr na
    // mesma. Tratá-lo como erro deixava creators importados e por analisar — foi o que
    // aconteceu ao @victtoramori e à @diacomnicoly na corrida de 02/09.
    if (!imp.saltado && !imp.com_legenda) { console.log(`  ✗ ${a.handle}: importou ${imp.gravados ?? 0} peças, nenhuma com legenda`); falhas++; continue; }
  }
  const j = await chamar(`/api/brand-scan?handle=${encodeURIComponent(a.handle)}`);
  if (j.error) { console.log(`  ✗ ${a.handle}: ${String(j.error).slice(0, 90)}`); falhas++; }
  else { ok++; console.log(`  ✓ ${a.handle} — ${(j.nichos ?? []).map((n) => `${n.nicho} ${n.pct}%`).join(", ") || "sem nichos"}`); }
  if ((i + 1) % 10 === 0) console.log(`  … ${i + 1}/${fila.length}`);
}
console.log(`\nfeitas ${ok}, falhas ${falhas}. Corre depois: node scripts/classificar-territorio.mjs`);
