#!/usr/bin/env node
// Classifica o TERRITÓRIO DE CONTEÚDO das creators que a derivação não resolve.
//
// O território sai, à leitura, do bucket do screening ou do pouco texto que a creator já
// tem (lib/territorio.js). Sobram ~411 creators sem classificação nenhuma: as que nunca
// passaram pelo screening ou saíram como "outros". Este script vai buscar evidência mais
// funda — bio, títulos dos vídeos e as análises do deep-scan — e grava o resultado em
// creators.territorio, que vence a derivação.
//
// Determinístico, sem IA: o território é vocabulário, e a mesma régua de lib/territorio.js
// aplicada a mais texto. Quem não tiver vocabulário de beleza nenhum fica sem território,
// que é a resposta honesta — há creators fora dos cinco (fitness, lifestyle, comida).
//
// DRY-RUN por omissão. --go grava.
//
// Uso:
//   node scripts/classificar-territorio.mjs                # o que faria, só os sem território
//   node scripts/classificar-territorio.mjs --go           # grava
//   node scripts/classificar-territorio.mjs --todos --go   # reclassifica toda a gente
//
// --todos existe para o dia em que a régua mudar, mas NÃO é o caminho normal: gravar o
// território de quem a derivação já resolve congela-o, e ele deixa de acompanhar o
// screening quando este correr outra vez.

import { readFileSync } from "node:fs";
import { territorioDe, territorioDoTexto, TERRITORIO_LABEL } from "../lib/territorio.js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA = "https://rpwkwulugrwxkzqudkeu.supabase.co";
if (!SR) { console.error("Falta SUPABASE_SERVICE_ROLE_KEY em .env.local"); process.exit(1); }

const GO = process.argv.includes("--go");
const TODOS = process.argv.includes("--todos");
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
// Um termo distinto chega: o que protege a precisão é a fronteira de palavra em
// lib/territorio.js, não o limiar. Medido a 02/09: com fronteira, os casos de acerto único
// são bios reais de beleza (harmonização, micropigmentação, lash) e não ruído. --min 2 faz
// uma passagem mais exigente (46 em vez de 116) para quem quiser rever menos.
// Limiar para o TEXTO DOS VÍDEOS (a bio vale sempre por um termo). Medido a 02/09.
const MIN_HITS = (() => { const i = process.argv.indexOf("--min"); return i > -1 ? Number(process.argv[i + 1]) : 3; })();

// PostgREST corta em 1000: tudo o que percorre a base inteira tem de paginar
async function todas(path, campos, extra = "") {
  const out = []; const passo = 1000;
  for (let de = 0; ; de += passo) {
    const r = await fetch(`${SUPA}/rest/v1/${path}?select=${campos}${extra}&order=id&offset=${de}&limit=${passo}`, { headers: H });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300));
    out.push(...j);
    if (j.length < passo) return out;
  }
}

console.log("A ler a base…");
const creators = await todas("creators", "id,name,handle,bio,niche,category,brand_history,kol_screen,territorio");
const videos = await todas("videos", "creator_id,title,analysis");

// texto por creator: títulos dos vídeos + o que o deep-scan escreveu sobre eles
const textoDeVideo = {};
for (const v of videos) {
  const a = v.analysis || {};
  const pedacos = [v.title, a.tema, a.resumo, a.gancho, a.hook, a.estrutura, Array.isArray(a.temas) ? a.temas.join(" ") : null];
  const t = pedacos.filter(Boolean).join(" ");
  if (t) textoDeVideo[v.creator_id] = `${textoDeVideo[v.creator_id] || ""} ${t}`.slice(0, 8000);
}

const conta = { ja_tinha: 0, lifestyle: 0, resolvido: 0, sem_evidencia: 0, mudou: 0 };
const escrever = [];
for (const c of creators) {
  const nichos = (c.brand_history?.nichos ?? []).map((n) => n.nicho).join(" ");
  const analisado = (c.brand_history?.nichos ?? []).length > 0;
  const derivado = territorioDe({
    guardado: TODOS ? null : c.territorio,
    bucket: c.kol_screen?.metricas?.niche_bucket ?? null,
    textos: [nichos, c.niche, c.category],
    analisado,
  });
  if (derivado && !TODOS) { conta[derivado === "lifestyle" ? "lifestyle" : "ja_tinha"]++; continue; }

  // Quem já foi analisado saiu acima como Lifestyle — a IA leu o conteúdo e não achou
  // beleza, e isso é resposta e não lacuna. Aqui em baixo ficam só os que NUNCA foram
  // analisados. Nota: `sub_nichos` não entra na evidência de propósito. É adjacência
  // sugerida, não descrição: um creator de musculação, uma estudante de medicina e um
  // resort francês tinham lá "Skincare masculino"/"Skincare minimalista" e entraram como
  // skincare na primeira corrida, com `nichos` a dizer Lifestyle 100%.

  // Sem análise de nichos, vale o que a creator diz de si (bio) e o que publica (títulos e
  // análises dos vídeos). A bio é auto-descrição deliberada: um termo chega. O texto dos
  // vídeos é longo e fala de tudo — aí exigem-se MIN_HITS termos distintos, senão uma
  // palavra de passagem classificava um DJ como skincare.
  const achado = territorioDoTexto(c.bio, 1) ?? territorioDoTexto(textoDeVideo[c.id], MIN_HITS);
  if (!achado) { conta.sem_evidencia++; continue; }
  // Lifestyle NÃO se grava a partir de uma bio: o valor guardado vence a derivação para
  // sempre, e uma bio que diz "Publi e Social Media" ou "UGC Creator" congelaria a creator
  // como lifestyle antes de alguém lhe ter olhado o conteúdo. Lifestyle é conclusão da
  // análise (brand_history.nichos), e essa a derivação já a devolve sozinha.
  if (achado === "lifestyle") { conta.sem_evidencia++; continue; }
  if (achado === c.territorio) { conta.ja_tinha++; continue; }

  conta[derivado ? "mudou" : "resolvido"]++;
  escrever.push({ id: c.id, handle: c.handle, name: c.name, territorio: achado });
}

console.log(`\ncreators: ${creators.length}`);
console.log(`já classificados em beleza: ${conta.ja_tinha}`);
console.log(`Lifestyle (analisados, sem beleza): ${conta.lifestyle}`);
console.log(`resolvidos por bio/vídeos: ${conta.resolvido}`);
if (TODOS) console.log(`reclassificados: ${conta.mudou}`);
console.log(`ficam sem território: ${conta.sem_evidencia}`);

const porTerr = {};
for (const e of escrever) porTerr[e.territorio] = (porTerr[e.territorio] || 0) + 1;
console.log("\ndistribuição do que seria gravado:");
for (const [t, n] of Object.entries(porTerr).sort((a, b) => b[1] - a[1])) console.log(`  ${TERRITORIO_LABEL[t].padEnd(12)} ${n}`);
console.log("\namostra:");
console.table(escrever.slice(0, 12).map((e) => ({ handle: e.handle, nome: (e.name || "").slice(0, 28), territorio: e.territorio })));

if (!GO) { console.log(`\nDRY-RUN. ${escrever.length} linhas seriam gravadas — corre com --go.`); process.exit(0); }

console.log(`\nA gravar ${escrever.length} linhas…`);
let feitas = 0;
for (const e of escrever) {
  const r = await fetch(`${SUPA}/rest/v1/creators?id=eq.${e.id}`, {
    method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify({ territorio: e.territorio }),
  });
  if (!r.ok) { console.error(`falhou ${e.handle}: ${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
  if (++feitas % 50 === 0) console.log(`  ${feitas}/${escrever.length}`);
}
console.log(`\nGravadas ${feitas} de ${escrever.length}.`);
