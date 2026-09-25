#!/usr/bin/env node
// Backfill das fotos dos creators para a chave ESTÁVEL thumbs/avatars/<creator_id>.jpg
// (feedback rodada 2, B4, 21/09/2026 — ver lib/avatar-store.js e /api/thumb?avatar=<id>).
//
// Modo por omissão (GRÁTIS, só banda): para cada creator ainda sem avatars/<id>.jpg
//   (a) copia a cópia antiga do proxy, thumbs/<sha1(avatar_url)>, se existir;
//   (b) senão descarrega o avatar_url se ainda estiver vivo (cloudfront da Tubular,
//       ggpht/googleusercontent, ou URL assinada do IG/TikTok ainda dentro do prazo).
// Resumível: quem já tem avatars/<id>.jpg é saltado. Nada é apagado nem reescrito na base.
//
// --apify         (PAGO, desligado por omissão) re-lê o perfil no Apify para quem continua
//                 sem foto, grava o avatar_url fresco e sobe a foto. Sem --go só imprime a
//                 estimativa (dry-run). Instagram: apify~instagram-profile-scraper (o mesmo do
//                 cron/collect e do promote-apify), em lotes de usernames. TikTok:
//                 clockworks~tiktok-scraper — BLOQUEADO desde 11/09 (403
//                 full-permission-actor-not-approved) até o dono da conta aprovar o actor na
//                 consola do Apify; sem isso a parte TikTok falha lote a lote.
//                 Precisa de APIFY_TOKEN (só existe na Vercel): export APIFY_TOKEN=...
// --perfil-publico  (grátis, lento) para quem continua sem foto, lê a foto da página pública
//                 do perfil: TikTok "avatarLarger", Instagram og:image. Pára uma rede ao fim de
//                 15 falhas seguidas (bloqueio). Corre-se ANTES do --apify para o encolher.
// --thumbs-recentes  guarda a miniatura das últimas 6 peças de cada creator pelas mesmas
//                 chaves do /api/thumb (sha1(thumb), ou sha1("fb:"+url) sem thumb), usando o
//                 fallback grátis do proxy: Instagram /p/<id>/media e oEmbed do TikTok.
//                 Use --limite N para amostra.
//
// Opções: --limite N (creators) · --conc N (paralelismo, 6) · --plataforma instagram|tiktok
//
// Uso:
//   node scripts/backfill-avatares.mjs                         # backfill grátis, todos
//   node scripts/backfill-avatares.mjs --apify                 # estimativa do pago (dry-run)
//   APIFY_TOKEN=... node scripts/backfill-avatares.mjs --apify --go --plataforma instagram
//   node scripts/backfill-avatares.mjs --thumbs-recentes --limite 50

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/Users/rui/risingstars/package.json");
const { createClient } = require("@supabase/supabase-js");

// ── env ────────────────────────────────────────────────────────────────────
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) { console.error("SUPABASE_SERVICE_ROLE_KEY em falta (.env.local)"); process.exit(1); }
const db = createClient(SUPA, SR, { auth: { persistSession: false }, global: { fetch: (u, o) => fetch(u, { ...o, cache: "no-store" }) } });

// ── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const tem = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMITE = Number(val("--limite", 0)) || 0;
const CONC = Number(val("--conc", 6)) || 6;
const PLAT = val("--plataforma", null);

// ── constantes partilhadas com lib/avatar-store.js e app/api/thumb ──────────
const BUCKET = "thumbs";
const ALLOWED = /(\.cdninstagram\.com|\.fbcdn\.net|\.tiktokcdn(-us|-eu)?\.com|\.ggpht\.com|\.googleusercontent\.com|\.cloudfront\.net)$/;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const avatarKey = (id) => (UUID_RE.test(String(id || "")) ? `avatars/${String(id).toLowerCase()}.jpg` : null);
// chaves aceites no bucket: sha1 hex ou avatars/<uuid>.jpg — mais nada sobe (pentest set/2026)
const CHAVE_RE = /^(?:[0-9a-f]{40}|avatars\/[0-9a-f-]{36}\.jpg)$/i;
const publico = (key) => `${SUPA}/storage/v1/object/public/${BUCKET}/${key}`;
const hostOk = (u) => { try { return ALLOWED.test(new URL(u).hostname); } catch { return false; } };
const imgType = (ct) => (ct && ct.toLowerCase().startsWith("image")) ? ct : "image/jpeg";
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Prazo das URLs assinadas: Instagram `oe=<hex, epoch s>`, TikTok `x-expires=<epoch s>`
function expirada(u) {
  if (!u) return true;
  const agora = Date.now() / 1000 + 60;
  const oe = u.match(/[?&]oe=([0-9A-Fa-f]+)/);
  if (oe) return parseInt(oe[1], 16) < agora;
  const xe = u.match(/[?&]x-expires=(\d+)/);
  if (xe) return Number(xe[1]) < agora;
  return false; // cloudfront / ggpht / sem assinatura: tenta
}

async function grab(url, timeoutMs = 12000) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "image/*" }, signal: AbortSignal.timeout(timeoutMs) });
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!r.ok || !(ct.startsWith("image") || ct.includes("octet-stream") || ct === "" || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length ? { buf, ct: imgType(ct) } : null;
  } catch { return null; }
}

async function subir(key, img) {
  if (!CHAVE_RE.test(String(key || ""))) return false;
  const { error } = await db.storage.from(BUCKET).upload(key, img.buf, { contentType: img.ct, upsert: true, cacheControl: "86400" });
  return !error;
}

// Lista todos os nomes de uma "pasta" do bucket (paginado)
async function listar(prefixo = "") {
  const nomes = new Set();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefixo, { limit: 1000, offset: off, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`storage.list(${prefixo}): ${error.message}`);
    for (const o of data || []) if (o.id) nomes.add(prefixo ? `${prefixo}/${o.name}` : o.name);
    if (!data || data.length < 1000) break;
  }
  return nomes;
}

async function todosCreators() {
  const out = [];
  for (let off = 0; ; off += 1000) {
    let q = db.from("creators").select("id, handle, platform, avatar_url").order("id").range(off, off + 999);
    if (PLAT) q = q.eq("platform", PLAT);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return LIMITE ? out.slice(0, LIMITE) : out;
}

async function emParalelo(itens, fn, conc = CONC) {
  let i = 0, feitos = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < itens.length) {
      const it = itens[i++];
      await fn(it);
      if (++feitos % 200 === 0) console.error(`  … ${feitos}/${itens.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
      await pausa(50); // educado com as CDNs
    }
  }));
}

// ── 1. backfill grátis ──────────────────────────────────────────────────────
async function backfillGratis() {
  console.error("a listar o bucket…");
  const [raiz, avatares] = await Promise.all([listar(""), listar("avatars")]);
  const creators = await todosCreators();
  const pendentes = creators.filter((c) => !avatares.has(avatarKey(c.id)));
  console.error(`${creators.length} creators · ${creators.length - pendentes.length} já com avatars/<id>.jpg · ${pendentes.length} por tratar`);

  const cont = { ja_tinham: creators.length - pendentes.length, copiados: 0, descarregados: 0, faltam: 0 };
  const faltam = [];
  await emParalelo(pendentes, async (c) => {
    const u = c.avatar_url;
    // (a) cópia sha1 antiga do proxy
    if (u && raiz.has(sha1(u))) {
      const img = await grab(publico(sha1(u)));
      if (img && await subir(avatarKey(c.id), img)) { cont.copiados++; return; }
    }
    // (b) origem ainda viva
    if (u && hostOk(u) && !expirada(u)) {
      const img = await grab(u);
      if (img && await subir(avatarKey(c.id), img)) { cont.descarregados++; return; }
    }
    cont.faltam++;
    faltam.push({ id: c.id, handle: c.handle, platform: c.platform, motivo: !u ? "sem avatar_url" : !hostOk(u) ? "host" : expirada(u) ? "expirada" : "origem falhou" });
  });

  const porPlat = {};
  for (const f of faltam) {
    const k = `${f.platform}/${f.motivo}`;
    porPlat[k] = (porPlat[k] || 0) + 1;
  }
  const saida = join(tmpdir(), "backfill-avatares-faltam.json");
  writeFileSync(saida, JSON.stringify(faltam, null, 1));
  console.log(JSON.stringify({ ...cont, faltam_por_plataforma_motivo: porPlat, lista_faltam: saida }, null, 2));
}

// ── 1b. página pública do perfil (grátis, lenta de propósito) ──────────────
// Sondado a 21/09/2026: a página pública do TikTok traz "avatarLarger" no JSON de
// hidratação e a do Instagram traz a foto em <meta property="og:image"> — ambas sem login
// e sem custo. A API web_profile_info do Instagram pede login (401) e não serve.
// Devagar (2 em paralelo, pausa de 1,5 s) e pára uma rede ao fim de 15 falhas seguidas —
// sinal de bloqueio/rate-limit. Só sobe a foto; não mexe no avatar_url da base.
const desescapar = (s) => s.replace(/\\u002F/g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
async function fotoPublica(c) {
  const h = String(c.handle || "").replace(/^@/, "");
  if (!h) return null;
  try {
    if (c.platform === "tiktok") {
      const html = await fetch(`https://www.tiktok.com/@${encodeURIComponent(h)}`, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" }, signal: AbortSignal.timeout(15000) }).then((r) => r.text());
      const m = html.match(/"avatarLarger":"([^"]+)"/) || html.match(/"avatarMedium":"([^"]+)"/);
      return m ? desescapar(m[1]) : null;
    }
    if (c.platform === "instagram") {
      const html = await fetch(`https://www.instagram.com/${encodeURIComponent(h)}/`, { headers: { "User-Agent": UA, Accept: "text/html", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Fetch-Site": "none" }, signal: AbortSignal.timeout(15000) }).then((r) => r.text());
      const m = html.match(/<meta property="og:image" content="([^"]+)"/);
      return m ? desescapar(m[1]) : null;
    }
  } catch {}
  return null;
}

async function perfilPublico() {
  const avatares = await listar("avatars");
  const creators = (await todosCreators()).filter((c) => !avatares.has(avatarKey(c.id)) && c.handle);
  console.error(`${creators.length} creators sem foto durável — a tentar a página pública`);
  const cont = { tentados: 0, guardados: 0, sem_foto: 0, parados: [] };
  const seguidas = { instagram: 0, tiktok: 0 };
  const porRede = { instagram: { ok: 0, falha: 0 }, tiktok: { ok: 0, falha: 0 } };
  await emParalelo(creators, async (c) => {
    if (seguidas[c.platform] >= 15) return;
    cont.tentados++;
    const pic = await fotoPublica(c);
    const img = pic && hostOk(pic) ? await grab(pic) : null;
    const ok = img && await subir(avatarKey(c.id), img);
    const r = porRede[c.platform] || (porRede[c.platform] = { ok: 0, falha: 0 });
    if (ok) { cont.guardados++; r.ok++; seguidas[c.platform] = 0; }
    else {
      cont.sem_foto++; r.falha++;
      if (++seguidas[c.platform] === 15) { cont.parados.push(c.platform); console.error(`  ${c.platform}: 15 falhas seguidas — parado (bloqueio?)`); }
    }
    await pausa(1500);
  }, 2);
  console.log(JSON.stringify({ ...cont, por_rede: porRede }, null, 2));
}

// ── 2. refresh pago pelo Apify (desligado por omissão) ──────────────────────
// Preços de LISTA (confirmar na consola do Apify antes de correr; nunca reconciliados com
// fatura): instagram-profile-scraper ≈ US$ 2,60 / 1.000 perfis; tiktok-scraper ≈ US$ 0,30
// por 1.000 resultados + arranque — com resultsPerPage 1 cada perfil devolve ~1 item.
const PRECO_IG_POR_MIL = 2.6;
const PRECO_TT_POR_MIL = 5.0; // conservador: arranque por lote + resultado; ver nota acima
const LOTE_APIFY = 50;

async function apifyRun(actor, input) {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=280`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(300_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

async function refreshApify() {
  const avatares = await listar("avatars");
  const creators = (await todosCreators()).filter((c) => !avatares.has(avatarKey(c.id)) && c.handle);
  const ig = creators.filter((c) => c.platform === "instagram");
  const tt = creators.filter((c) => c.platform === "tiktok");
  const est = {
    instagram: { perfis: ig.length, lotes: Math.ceil(ig.length / LOTE_APIFY), usd: +(ig.length / 1000 * PRECO_IG_POR_MIL).toFixed(2), actor: "apify~instagram-profile-scraper" },
    tiktok: { perfis: tt.length, lotes: Math.ceil(tt.length / LOTE_APIFY), usd: +(tt.length / 1000 * PRECO_TT_POR_MIL).toFixed(2), actor: "clockworks~tiktok-scraper",
      aviso: "403 full-permission-actor-not-approved desde 11/09 — aprovar o actor na consola do Apify antes" },
  };
  console.log(JSON.stringify({ estimativa: est, total_usd: +(est.instagram.usd + est.tiktok.usd).toFixed(2) }, null, 2));
  if (!tem("--go")) { console.log("dry-run: nada foi chamado. Para correr: --apify --go (e APIFY_TOKEN)."); return; }
  if (!process.env.APIFY_TOKEN) { console.error("APIFY_TOKEN em falta"); process.exit(1); }

  const cont = { atualizados: 0, sem_foto: 0, lotes_falhados: 0 };
  const porHandle = (lista) => new Map(lista.map((c) => [String(c.handle).toLowerCase().replace(/^@/, ""), c]));
  const gravar = async (c, pic) => {
    if (!pic) { cont.sem_foto++; return; }
    await db.from("creators").update({ avatar_url: pic }).eq("id", c.id);
    const img = hostOk(pic) ? await grab(pic) : null;
    if (img && await subir(avatarKey(c.id), img)) cont.atualizados++; else cont.sem_foto++;
  };

  for (let i = 0; i < ig.length; i += LOTE_APIFY) {
    const lote = ig.slice(i, i + LOTE_APIFY), mapa = porHandle(lote);
    try {
      const itens = await apifyRun("apify~instagram-profile-scraper", { usernames: [...mapa.keys()], resultsLimit: 1 });
      for (const p of itens) {
        const c = mapa.get(String(p.username || "").toLowerCase());
        if (c) { mapa.delete(p.username.toLowerCase()); await gravar(c, p.profilePicUrlHD ?? p.profilePicUrl ?? null); }
      }
      cont.sem_foto += mapa.size;
    } catch (e) { cont.lotes_falhados++; console.error(String(e).slice(0, 200)); }
    console.error(`  IG ${Math.min(i + LOTE_APIFY, ig.length)}/${ig.length}`, cont);
  }
  for (let i = 0; i < tt.length; i += LOTE_APIFY) {
    const lote = tt.slice(i, i + LOTE_APIFY), mapa = porHandle(lote);
    try {
      const itens = await apifyRun("clockworks~tiktok-scraper", { profiles: [...mapa.keys()], resultsPerPage: 1, shouldDownloadVideos: false });
      for (const it of itens) {
        const am = it.authorMeta || {};
        const h = String(am.name || am.uniqueId || "").toLowerCase();
        const c = mapa.get(h);
        if (c) { mapa.delete(h); await gravar(c, am.avatar ?? null); }
      }
      cont.sem_foto += mapa.size;
    } catch (e) {
      cont.lotes_falhados++; console.error(String(e).slice(0, 200));
      if (/full-permission-actor-not-approved/.test(String(e))) { console.error("actor TikTok por aprovar — parado"); break; }
    }
    console.error(`  TT ${Math.min(i + LOTE_APIFY, tt.length)}/${tt.length}`, cont);
  }
  console.log(JSON.stringify(cont, null, 2));
}

// ── 3. miniaturas das últimas 6 peças ───────────────────────────────────────
async function thumbsRecentes() {
  const raiz = await listar("");
  const creators = await todosCreators();
  const cont = { creators: creators.length, pecas: 0, ja_em_cache: 0, pela_thumb: 0, pelo_link: 0, falhou: 0, falhou_ig: 0, falhou_tt: 0, sem_link: 0 };
  await emParalelo(creators, async (c) => {
    const { data: vids } = await db.from("videos").select("id, url, thumb, posted_at")
      .eq("creator_id", c.id).order("posted_at", { ascending: false, nullsFirst: false }).limit(6);
    for (const v of vids || []) {
      cont.pecas++;
      if (!v.thumb && !v.url) { cont.sem_link++; continue; }
      const key = v.thumb ? sha1(v.thumb) : sha1(`fb:${v.url}`);
      if (raiz.has(key)) { cont.ja_em_cache++; continue; }
      let img = null, via = null;
      if (v.thumb && hostOk(v.thumb) && !expirada(v.thumb)) { img = await grab(v.thumb); via = "pela_thumb"; }
      const fb = v.url || "";
      if (!img) {
        const m = fb.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/);
        if (m) { img = await grab(`https://www.instagram.com/p/${m[1]}/media/?size=l`); via = "pelo_link"; }
      }
      if (!img && /tiktok\.com\/.*video\/\d+/.test(fb)) {
        try {
          const oe = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(fb)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }).then((x) => x.json());
          if (oe?.thumbnail_url) { img = await grab(oe.thumbnail_url); via = "pelo_link"; }
        } catch {}
      }
      if (img && await subir(key, img)) { cont[via]++; raiz.add(key); }
      else { cont.falhou++; if (/instagram/.test(fb)) cont.falhou_ig++; else if (/tiktok/.test(fb)) cont.falhou_tt++; }
      await pausa(150);
    }
  }, Math.min(CONC, 4));
  const tentadas = cont.pecas - cont.ja_em_cache - cont.sem_link;
  console.log(JSON.stringify({ ...cont, taxa_sucesso: tentadas ? +((cont.pela_thumb + cont.pelo_link) / tentadas).toFixed(3) : null }, null, 2));
}

// ── main ────────────────────────────────────────────────────────────────────
if (tem("--apify")) await refreshApify();
else if (tem("--perfil-publico")) await perfilPublico();
else if (tem("--thumbs-recentes")) await thumbsRecentes();
else await backfillGratis();
