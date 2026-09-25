import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import {
  SUPA_URL as SUPA, THUMBS_BUCKET, grab, imgType, hostPermitido, idValido, chaveSegura,
  avatarPublicUrl, subirAvatar, UA,
} from "@/lib/avatar-store";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Sem imagem viva, fundo neutro SEM glifo. A estrela dourada saiu (feedback rodada 2, B4,
// set/2026): o cliente lia-a como "creator sem foto"/erro. Os avatares pedem sempre ?sf=1
// e mostram a inicial do nome; este fundo só sobra para miniaturas pedidas sem sf.
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#1b1a22"/></svg>`;
const IMG_HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000" };
const img = (body, ct) => new NextResponse(body, { headers: { "Content-Type": imgType(ct), ...IMG_HEADERS } });
const semImagem = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, max-age=600" } });

/**
 * ?avatar=<creator_id> — avatar do creator pela chave ESTÁVEL (lib/avatar-store.js):
 *  1) thumbs/avatars/<id>.jpg (gravado na recolha ou pelo backfill);
 *  2) o avatar_url actual da base: cópia sha1 antiga do proxy, ou a origem se a assinatura
 *     ainda vale — e o que se encontrar fica guardado em avatars/<id>.jpg para a próxima;
 *  3) nada → 404 (o chamador mostra a inicial). Nunca a estrela.
 * O URL de origem vem da base, não da query: ninguém escreve na chave de outro creator.
 */
async function servirAvatar(id) {
  const duravel = await grab(avatarPublicUrl(id));
  if (duravel) return img(duravel.body, duravel.headers.get("content-type"));

  let u = null;
  try {
    const { data } = await supabaseAdmin().from("creators").select("avatar_url").eq("id", id).maybeSingle();
    u = data?.avatar_url || null;
  } catch {}
  if (!u) return semImagem();

  const key = crypto.createHash("sha1").update(u).digest("hex");
  let r = await grab(`${SUPA}/storage/v1/object/public/${THUMBS_BUCKET}/${key}`);
  if (!r && hostPermitido(u)) r = await grab(u);
  if (!r) return semImagem();
  const ct = r.headers.get("content-type");
  const buf = Buffer.from(await r.arrayBuffer());
  await subirAvatar(supabaseAdmin(), id, buf, ct);
  return img(buf, ct);
}

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const sp = new URL(req.url).searchParams;
  const avatar = sp.get("avatar");
  if (avatar) return idValido(avatar) ? servirAvatar(avatar) : semImagem();

  const u = sp.get("u");
  const fb = sp.get("fb");
  // Peça sem `thumb` gravada (só o link): a imagem resolvida pelo `fb` também fica em cache,
  // com chave sha1("fb:" + link) — as mesmas chaves que scripts/backfill-avatares.mjs usa.
  // A chave é o sha1 hex do link (40 chars [0-9a-f]) — o que vem da query nunca entra no
  // caminho do Storage, só o seu hash, e mesmo esse passa por chaveSegura (pentest set/2026).
  const hash = u ? crypto.createHash("sha1").update(u).digest("hex")
    : fb ? crypto.createHash("sha1").update(`fb:${fb}`).digest("hex") : null;
  const key = chaveSegura(hash) ? hash : null;

  // 1) cache durável no Storage (não expira, mesmo que a URL assinada da origem morra)
  if (key) {
    const cached = await grab(`${SUPA}/storage/v1/object/public/${THUMBS_BUCKET}/${key}`);
    if (cached) return img(cached.body, cached.headers.get("content-type"));
  }

  // 2) busca na origem enquanto a assinatura vale, e cacheia pra próxima
  let r = null;
  if (u && hostPermitido(u)) r = await grab(u);
  if (!r && fb) { const m = fb.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/); if (m) r = await grab(`https://www.instagram.com/p/${m[1]}/media/?size=l`); }
  // fallback TikTok: thumbs da Tubular expiram; o oEmbed público devolve uma thumbnail fresca pelo ID do vídeo
  if (!r && fb && /tiktok\.com\/.*video\/\d+/.test(fb)) {
    try {
      const oe = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(fb)}`, { headers: { "User-Agent": UA } }).then((x) => x.json());
      if (oe?.thumbnail_url) r = await grab(oe.thumbnail_url);
    } catch {}
  }

  if (r) {
    const ct = imgType(r.headers.get("content-type"));
    const buf = Buffer.from(await r.arrayBuffer());
    // a chave é sempre um sha1 hex — validada mesmo assim antes de tocar no Storage (pentest set/2026)
    if (key) { try { await supabaseAdmin().storage.from(THUMBS_BUCKET).upload(key, buf, { contentType: ct, upsert: true }); } catch {} }
    return img(buf, ct);
  }

  // sem imagem viva: fundo neutro (cache curto pra tentar de novo quando a URL renovar).
  // Com ?sf=1 devolve 404 — o chamador troca o <img> pela inicial (avatares) ou por um
  // estado vazio (miniaturas) via onError.
  if (sp.get("sf")) return semImagem();
  return new NextResponse(PLACEHOLDER, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=600" } });
}
