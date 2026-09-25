// PERFIL DE REFERÊNCIA — o link que o briefing traz (feedback do cliente, set/2026, ponto 3)
// e o que ele pesa no casting.
//
// O cliente cola o link de um creator "do tipo que queremos". Quando esse creator está na
// base, os sub-nichos e o território dele entram como palavras-chave do match, e quem
// partilha um sub-nicho com ele leva um empurrão pequeno no fit e a menção no "por que
// entra". Quando não está, o casting diz isso e aponta para o "Validar creator".

/** "https://www.instagram.com/alan_vivian/" · "tiktok.com/@cabeleireirocalvo?lang=pt" · "@handle" → handle em minúsculas, ou null. */
export function handleDoLink(link) {
  const s = String(link || "").trim();
  if (!s) return null;
  const m = s.match(/(?:instagram\.com|tiktok\.com|youtube\.com)\/@?([A-Za-z0-9._]{2,60})/i)
    || s.match(/^@?([A-Za-z0-9._]{2,60})$/);
  if (!m) return null;
  const h = m[1].toLowerCase().replace(/\/$/, "");
  return ["p", "reel", "reels", "video", "explore", "stories"].includes(h) ? null : h;
}

const norm = (s) => String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Sub-nichos de um brand_history como lista de strings normalizadas. */
export function subNichosDe(history) {
  return (history?.sub_nichos || [])
    .map((s) => (typeof s === "string" ? s : s?.nome || s?.sub_nicho))
    .filter(Boolean).map(norm);
}

/** Território principal de um brand_history ("Cabelo 80%" → "cabelo"). */
export function nichoPrincipalDe(history) {
  const ns = (history?.nichos || []).filter((n) => n?.nicho);
  if (!ns.length) return null;
  const top = ns.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
  return norm(String(top.nicho).split(/[&/|,]/)[0]);
}

/**
 * Resolve o perfil de referência contra a lista de creators já carregada.
 * Devolve null sem link; { encontrado:false, handle } se não está na base; senão o retrato
 * que o casting usa (id, handle, seguidores, nicho, sub_nichos).
 */
export function resolverReferencia(link, creators) {
  const handle = handleDoLink(link);
  if (!handle) return null;
  const c = (creators || []).find((x) => String(x.handle || "").toLowerCase() === handle);
  if (!c) return { encontrado: false, handle };
  return {
    encontrado: true, id: c.id, handle: c.handle, platform: c.platform, followers: Number(c.followers) || 0,
    nicho: nichoPrincipalDe(c.brand_history), sub_nichos: subNichosDe(c.brand_history),
  };
}

/** Palavras-chave que o perfil de referência acrescenta ao briefing. */
export function keywordsDaReferencia(ref) {
  if (!ref?.encontrado) return [];
  return [...new Set([ref.nicho, ...(ref.sub_nichos || [])].filter(Boolean))];
}

/** A creator partilha pelo menos um sub-nicho com o perfil de referência? */
export function partilhaSubNicho(history, ref) {
  if (!ref?.encontrado || !ref.sub_nichos?.length) return false;
  const meus = subNichosDe(history);
  return meus.some((s) => ref.sub_nichos.includes(s));
}
