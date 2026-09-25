/**
 * Cópia durável do avatar do creator no Storage (bucket público `thumbs`).
 *
 * Porquê (feedback rodada 2, B4, 21/09/2026): 81% dos `creators.avatar_url` são URLs
 * assinadas do Instagram (`oe=`) e do TikTok (`x-expires=`) que já tinham expirado; o
 * /api/thumb só guardava cópia (chave sha1 do URL) quando alguém abria a imagem a tempo, e o
 * cliente via a estrela de fallback no lugar da foto. Agora a foto é guardada NO MOMENTO em
 * que se escreve o `avatar_url` — enquanto a assinatura ainda vale — numa chave ESTÁVEL por
 * creator (`avatars/<creator_id>.jpg`), que sobrevive à renovação do URL. Sem coluna nova:
 * o caminho é determinístico e o /api/thumb?avatar=<id> serve-o primeiro.
 *
 * Tudo aqui é best-effort: uma falha a guardar a foto nunca parte a rota que a chama.
 */

export const THUMBS_BUCKET = "thumbs";
export const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rpwkwulugrwxkzqudkeu.supabase.co";
// Mesmas origens que o proxy aceita (CDNs de imagem das redes, Tubular e IC). O -eu do
// TikTok faltava (165 avatares em tiktokcdn-eu.com nunca passavam no proxy, 21/09/2026).
export const ALLOWED_HOSTS = /(\.cdninstagram\.com|\.fbcdn\.net|\.tiktokcdn(-us|-eu)?\.com|\.ggpht\.com|\.googleusercontent\.com|\.cloudfront\.net)$/;
export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024;

export const idValido = (id) => UUID.test(String(id || ""));
// só um uuid válido vira chave; qualquer outra coisa dá null e nunca chega ao Storage
export const avatarKey = (creatorId) => (idValido(creatorId) ? `avatars/${String(creatorId).toLowerCase()}.jpg` : null);
// Chaves aceites no bucket: sha1 hex (miniaturas do proxy) ou avatars/<uuid>.jpg. Nada mais
// chega ao Storage — sem "..", sem "/", sem texto livre (pentest set/2026, path traversal).
const CHAVE = /^(?:[0-9a-f]{40}|avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg)$/i;
export const chaveSegura = (key) => CHAVE.test(String(key || ""));
export const hostPermitido = (url) => { try { return ALLOWED_HOSTS.test(new URL(url).hostname); } catch { return false; } };
export const avatarPublicUrl = (creatorId) => `${SUPA_URL}/storage/v1/object/public/${THUMBS_BUCKET}/${avatarKey(creatorId)}`;

/** GET de uma imagem; devolve a Response só se for imagem utilizável. */
export async function grab(url, { timeoutMs } = {}) {
  try {
    const r = await fetch(url, {
      redirect: "follow", cache: "no-store",
      headers: { "User-Agent": UA, "Accept": "image/*" },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    // aceita imagem, octet-stream (cloudfront do IC às vezes manda assim) ou URL com extensão de imagem
    if (r.ok && (ct.startsWith("image") || ct.includes("octet-stream") || ct === "" || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return r;
  } catch {}
  return null;
}
export const imgType = (ct) => (ct && ct.toLowerCase().startsWith("image")) ? ct : "image/jpeg";

/** Sobe um buffer para avatars/<id>.jpg (upsert). */
export async function subirAvatar(db, creatorId, buf, contentType) {
  if (!idValido(creatorId) || !buf?.length) return false;
  const key = avatarKey(creatorId);
  if (!key || !chaveSegura(key)) return false;
  try {
    const { error } = await db.storage.from(THUMBS_BUCKET)
      .upload(key, buf, { contentType: imgType(contentType), upsert: true, cacheControl: "86400" });
    return !error;
  } catch { return false; }
}

/**
 * Descarrega `url` (enquanto a assinatura vale) e guarda em thumbs/avatars/<creatorId>.jpg.
 * `db` = cliente service role (supabaseAdmin()). Nunca lança; devolve { ok, motivo? }.
 */
export async function guardarAvatar(db, creatorId, url, { timeoutMs = 8000 } = {}) {
  if (!idValido(creatorId)) return { ok: false, motivo: "id inválido" };
  if (!url || !hostPermitido(url)) return { ok: false, motivo: "origem não permitida" };
  const r = await grab(url, { timeoutMs });
  if (!r) return { ok: false, motivo: "origem indisponível" };
  try {
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return { ok: false, motivo: "tamanho inválido" };
    const ok = await subirAvatar(db, creatorId, buf, r.headers.get("content-type"));
    return ok ? { ok: true } : { ok: false, motivo: "upload falhou" };
  } catch { return { ok: false, motivo: "leitura falhou" }; }
}
