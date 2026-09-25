/**
 * URL de exibição do avatar de um creator — seguro para server e client components.
 *
 * Com o id do creator pede-se /api/thumb?avatar=<id>: o proxy serve primeiro a cópia
 * durável (thumbs/avatars/<id>.jpg, lib/avatar-store.js) e só depois tenta o avatar_url
 * da base. Sempre com sf=1: sem foto viva o proxy devolve 404 e o chamador mostra a
 * inicial do nome (components/AvatarImg.js) — a estrela dourada saiu de todo o lado
 * (feedback rodada 2, B4, set/2026: o cliente lia-a como "creator sem foto").
 */
const PROXIADO = /cdninstagram|fbcdn|tiktokcdn|ggpht|googleusercontent|cloudfront/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function avatarSrc(url, creatorId) {
  if (creatorId && UUID.test(String(creatorId))) return `/api/thumb?sf=1&avatar=${creatorId}`;
  if (!url) return null;
  if (PROXIADO.test(url)) return `/api/thumb?sf=1&v=3&u=${encodeURIComponent(url)}`;
  return url;
}

export const inicialDe = (nome) => String(nome || "").trim().replace(/^@/, "").charAt(0).toUpperCase() || "?";
