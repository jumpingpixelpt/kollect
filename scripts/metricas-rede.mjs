#!/usr/bin/env node
// Backfill de creators.metricas_rede (feedback rodada 2, F1.7 — 21/09/2026; ver
// lib/metricas-rede.js e supabase/migrations/202609210010_metricas_rede.sql).
//
// Para cada PESSOA (contas com o mesmo person_key; sem person_key, a conta sozinha) lê as
// peças de todas as contas, calcula o retrato de 90 dias por rede + publi/orgânico + total
// e grava o MESMO JSON em cada conta da pessoa. Só lê `videos` e só escreve esta coluna.
// Grátis: não chama nenhuma API externa.
//
// Resumível: por omissão salta as pessoas em que todas as contas já têm metricas_rede.
// Pessoas sem peças com data ficam null e são revisitadas numa próxima corrida (custo de
// uma leitura vazia). --todos recalcula tudo (p.ex. depois de mudar a régua).
//
// Opções: --todos · --limite N (pessoas) · --lote N (contas por leitura de peças, 60) ·
//         --conc N (gravações em paralelo, 6) · --dry (calcula e imprime, não grava)
//
// Uso:
//   node scripts/metricas-rede.mjs
//   node scripts/metricas-rede.mjs --todos
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { calcularMetricasRede, VIDEOS_METRICAS } from "../lib/metricas-rede.js";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

// ── env ────────────────────────────────────────────────────────────────────
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) { console.error("SUPABASE_SERVICE_ROLE_KEY em falta (.env.local)"); process.exit(1); }
const db = createClient(SUPA, SR, { auth: { persistSession: false }, global: { fetch: (u, o) => fetch(u, { ...o, cache: "no-store" }) } });

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : Number(process.argv[i + 1]); };
const TODOS = process.argv.includes("--todos");
const DRY = process.argv.includes("--dry");
const LIMITE = arg("limite", Infinity);
const LOTE = arg("lote", 60);
const CONC = arg("conc", 6);

async function paginar(build) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await build().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

// ── pessoas ────────────────────────────────────────────────────────────────
const creators = await paginar(() => db.from("creators")
  .select("id,handle,platform,followers,person_key,feito:metricas_rede->>computed_at").order("id"));
const porPessoa = new Map();
for (const c of creators) {
  const k = c.person_key ? `pk:${c.person_key}` : `id:${c.id}`;
  (porPessoa.get(k) || porPessoa.set(k, []).get(k)).push(c);
}
let pessoas = [...porPessoa.values()];
const total = pessoas.length;
if (!TODOS) pessoas = pessoas.filter((cs) => cs.some((c) => !c.feito));
pessoas = pessoas.slice(0, LIMITE);
console.log(`${creators.length} creators · ${total} pessoas · a calcular ${pessoas.length}${DRY ? " (dry)" : ""}`);

// ── lotes: agrupa pessoas até ~LOTE contas por leitura de peças ────────────
const lotes = [];
let atual = [];
for (const p of pessoas) {
  if (atual.length && atual.flat().length + p.length > LOTE) { lotes.push(atual); atual = []; }
  atual.push(p);
}
if (atual.length) lotes.push(atual);

const cont = { gravadas: 0, com_dados: 0, sem_pecas: 0, erros: 0, pecas: 0 };
const t0 = Date.now();
for (let i = 0; i < lotes.length; i++) {
  const lote = lotes[i];
  const ids = lote.flat().map((c) => c.id);
  let videos;
  try {
    videos = await paginar(() => db.from("videos").select(VIDEOS_METRICAS).in("creator_id", ids).order("id"));
  } catch (e) { console.error(`lote ${i + 1}: leitura falhou — ${e.message}`); cont.erros += ids.length; continue; }
  cont.pecas += videos.length;
  const porCreator = {};
  for (const v of videos) (porCreator[v.creator_id] ||= []).push(v);

  const tarefas = lote.map((contas) => async () => {
    const json = calcularMetricasRede(contas, contas.flatMap((c) => porCreator[c.id] || []));
    if (json) cont.com_dados += contas.length; else cont.sem_pecas += contas.length;
    if (DRY) { if (json && cont.com_dados <= 3) console.log(JSON.stringify(json)); return; }
    const { error } = await db.from("creators").update({ metricas_rede: json }).in("id", contas.map((c) => c.id));
    if (error) { cont.erros += contas.length; console.error(`@${contas[0].handle}: ${error.message}`); }
    else cont.gravadas += contas.length;
  });
  for (let j = 0; j < tarefas.length; j += CONC) await Promise.all(tarefas.slice(j, j + CONC).map((f) => f()));
  if ((i + 1) % 10 === 0 || i === lotes.length - 1) {
    console.log(`lote ${i + 1}/${lotes.length} · ${cont.gravadas} gravadas · ${cont.com_dados} com dados · ${cont.sem_pecas} sem peças · ${cont.erros} erros · ${cont.pecas} peças · ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}
console.log("fim", cont);
