// Medição do Creators Hub contra a base configurada em .env.local (22/09/2026).
// Compara a montagem a frio de antes (RPC radar_base(false) + lib/radar-base.js) com a leitura
// da base pré-montada em `radar_cache` (lib/radar-cache.js), e o JSON das props da 1ª página.
// Só leitura por omissão; `--gravar` remonta e grava a linha de radar_cache (o que o cron faz).
// node scripts/medir-hub.mjs [--gravar] [--n=3]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { assembleRadarBase } from "../lib/radar-base.js";
import { fetchRadarSource } from "../lib/radar-source.js";
import { compactarBase, baseDoPayload, slimRow, RADAR_CACHE_VERSAO } from "../lib/radar-compacto.js";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
require("@next/env").loadEnvConfig(projectRoot, false, { info() {}, error() {} });
const { createClient } = require("@supabase/supabase-js");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Service role local indisponível");
// cliente novo por ensaio: aproxima a instância fria (sem nada em memória)
const novoCliente = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (i, o) => fetch(i, { ...o, cache: "no-store" }) },
});
const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4)) || 3;
const bytes = (x) => Buffer.byteLength(JSON.stringify(x));
const PAGINA_ANTES = 48, PAGINA_DEPOIS = 20;

// slimRow de antes de 22/09 (com avatar_url e fc), para medir as props antigas
const slimAntes = (c) => ({ ...slimRow(c), avatar_url: c.avatar_url, fc: c.fc });

let viva = null;
for (let i = 0; i < N; i++) {
  const db = novoCliente();
  const t0 = performance.now();
  const fonte = await fetchRadarSource(db, false);
  const t1 = performance.now();
  viva = assembleRadarBase(fonte);
  const t2 = performance.now();
  console.log(JSON.stringify({ caminho: "antes · RPC radar_base(false) + montagem", leituraMs: Math.round(t1 - t0), montagemMs: Math.round(t2 - t1),
    totalMs: Math.round(t2 - t0), payloadBytes: bytes(fonte), pessoas: viva.allUnfiltered.length,
    propsLinhas: bytes(viva.allUnfiltered.slice(0, PAGINA_ANTES).map(slimAntes)), linhasNaPagina: PAGINA_ANTES }));
}

if (process.argv.includes("--gravar")) {
  const db = novoCliente();
  const t0 = performance.now();
  const payload = compactarBase(assembleRadarBase(await fetchRadarSource(db, false)));
  const ms = Math.round(performance.now() - t0);
  const texto = JSON.stringify(payload);
  const t1 = performance.now();
  const { error } = await db.from("radar_cache").upsert({ chave: "hub", versao: RADAR_CACHE_VERSAO, payload, bytes: texto.length,
    linhas: payload.rows.length, duracao_ms: ms, gerado_em: new Date().toISOString(), refrescando_em: null }, { onConflict: "chave" });
  if (error) throw new Error(error.message);
  console.log(JSON.stringify({ gravado: true, montagemMs: ms, escritaMs: Math.round(performance.now() - t1), bytes: texto.length }));
}

for (let i = 0; i < N; i++) {
  const db = novoCliente();
  const t0 = performance.now();
  const { data, error } = await db.from("radar_cache").select("versao, gerado_em, payload").eq("chave", "hub").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) { console.log("radar_cache vazia — correr com --gravar"); break; }
  const t1 = performance.now();
  const base = baseDoPayload(data.payload);
  const t2 = performance.now();
  const props = base.allUnfiltered.slice(0, PAGINA_DEPOIS).map(slimRow);
  console.log(JSON.stringify({ caminho: "depois · linha de radar_cache", leituraMs: Math.round(t1 - t0), descodificarMs: Math.round(t2 - t1),
    totalMs: Math.round(t2 - t0), payloadBytes: bytes(data.payload), pessoas: base.allUnfiltered.length,
    idadeS: Math.round((Date.now() - new Date(data.gerado_em).getTime()) / 1000),
    propsLinhas: bytes(props), linhasNaPagina: PAGINA_DEPOIS, propsFiltros: bytes({ brands: base.brandOpts, topics: base.subnichoTopOpts }) }));
  // equivalência com a base viva medida acima (mesma ordem, mesmos campos de filtro/ordenação)
  if (viva && i === 0) {
    const a = viva.allUnfiltered, b = base.allUnfiltered;
    const iguais = a.length === b.length && a.every((c, j) => c.id === b[j].id);
    let difs = 0;
    for (let j = 0; j < Math.min(a.length, b.length); j++) {
      for (const k of ["platform", "territorio", "classe", "kol_nota", "total", "followers_combined", "eng_rate", "eng_per_post",
        "views_per_post", "avg_views", "_s", "_c", "_hs", "brand_keys", "subnicho_keys", "formato_keys"]) {
        try { assert.deepEqual(b[j][k] ?? null, a[j][k] ?? null); } catch { difs++; }
      }
    }
    console.log(JSON.stringify({ equivalencia: { mesmaOrdem: iguais, camposDiferentes: difs, nota: "difere só se a base mudou entre a montagem e a gravação" } }));
  }
}
