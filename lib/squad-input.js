export const validSquadId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// Aceita apenas páginas de perfil; um link de post ou domínio parecido não pode
// iniciar uma importação paga de outro perfil. A URL canônica não mantém tracking.
export function parseSquadProfile(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const value = raw.trim();
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    if (["instagram.com", "www.instagram.com"].includes(host)) {
      const handle = parts[0].toLowerCase();
      if (!/^[a-z0-9._]{1,30}$/.test(handle) || ["p", "reel", "reels", "stories", "explore", "accounts", "direct"].includes(handle)) return null;
      return { platform: "instagram", handle, url: `https://www.instagram.com/${handle}/` };
    }
    if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
      const match = parts[0].match(/^@([a-z0-9._]{1,24})$/i);
      if (!match) return null;
      const handle = match[1].toLowerCase();
      return { platform: "tiktok", handle, url: `https://www.tiktok.com/@${handle}` };
    }
  } catch {}
  return null;
}

// Filtros PostgREST têm sintaxe própria: não interpolar operadores vindos da busca.
export function squadSearchTerm(raw) {
  return String(raw || "").normalize("NFKC").replace(/^@/, "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 80);
}

export function squadItems(raw) {
  if (!Array.isArray(raw) || raw.length > 500) throw new Error("Envie até 500 perfis por vez.");
  const seen = new Set();
  return raw.map((it) => {
    if (!it || typeof it !== "object") throw new Error("Perfil inválido.");
    const creator_id = it.creator_id || null;
    const prospect_id = creator_id ? null : it.prospect_id;
    if (creator_id ? !validSquadId(creator_id) : typeof prospect_id !== "string" || !prospect_id.trim() || prospect_id.length > 200) {
      throw new Error("Perfil inválido.");
    }
    return { creator_id, prospect_id: prospect_id ?? null, match_score: Number.isFinite(it.match_score) ? it.match_score : null };
  }).filter((it) => {
    const key = it.creator_id ? `c:${it.creator_id}` : `p:${it.prospect_id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export async function addSquadItems(db, listId, items) {
  const { data, error } = await db.rpc("add_squad_items", { p_list_id: listId, p_items: squadItems(items) });
  if (error) throw new Error("Não foi possível incluir os perfis no squad.");
  if (!Number.isInteger(data) || data < 0) throw new Error("A inclusão não foi confirmada.");
  return data;
}
