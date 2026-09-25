/**
 * Tubular Labs API — wrapper com as lições do briefing:
 * auth via header Api-Key, throttle, creator.search v4, video.search v3 (v4 alpha trai).
 *
 * O transporte vive em lib/tubular-quota.js desde jul/2026. Havia aqui uma fila de throttle
 * própria, independente da de lá — duas filas a serializar para a mesma API que só aceita
 * uma chamada de cada vez (tubular-concurrencylimit: 1), o que garantia violações sempre que
 * uma varredura e a cadeia de enrich se cruzassem. Já havia um prospect com status
 * `erro tubular 429` na base.
 *
 * Delegar resolve as duas coisas ao mesmo tempo: uma só fila, e o piso de quota passa a
 * cobrir TODOS os consumidores — tubular-sync, tubular-backfill, promote, evaluate, discover
 * e sweep — em vez de só a descoberta nova. O /api/discover, em particular, gasta 40 unidades
 * por creator no creator.search e não tinha travão nenhum.
 */
import { tubularFetch } from "@/lib/tubular-quota";

export async function tubularPost(endpoint, body) {
  if (!process.env.TUBULAR_API_KEY) throw new Error("TUBULAR_API_KEY missing");
  const { json } = await tubularFetch(endpoint, body, { origem: `lib:${endpoint}` });
  if (json == null) throw new Error(`Tubular ${endpoint} non-JSON`);
  return json;
}

export async function searchCreator(query) {
  const body = await tubularPost("/v4/creator.search", {
    include: { search: query },
    fields: { snippet: true, performance: true, taxonomy: true },
    scroll: { size: 5 },
  });
  return body.results ?? [];
}

/** Fallback chain do briefing: URL com slash → sem slash → só handle. */
export async function searchCreatorByProfile(platform, handle) {
  const base = platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}`;
  for (const q of [`${base}/`, base, handle]) {
    try {
      const results = await searchCreator(q);
      if (results.length) return results[0];
    } catch {}
  }
  return null;
}

export async function getVideosByCreator(creatorIdOrGid, opts = {}) {
  const platforms = opts.platforms ?? ["tiktok", "instagram"];
  const size = opts.size ?? 25;
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - (opts.daysBack ?? 90) * 864e5).toISOString().slice(0, 10);
  const body = await tubularPost("/v3/video.search", {
    query: {
      include_filter: {
        creators: [creatorIdOrGid],
        video_platforms: platforms,
        video_upload_date: { min: since, max: today },
      },
    },
    fields: ["video_url", "title", "publisher", "views", "engagements", "publish_date", "platform", "thumbnail_url"],
    sort: { sort: "views_gain", sort_reverse: true, sort_date_range: { min: since, max: today } },
    scroll: { scroll_size: size },
  });
  return body.videos ?? body.results ?? [];
}

/** Taxonomy da Tubular → categoria do radar (corta IA do caminho). */
export function mapCategory(taxonomy) {
  const themes = (taxonomy?.themes ?? []).map((t) => (t.title || t.name || "").toLowerCase()).join(" ");
  const genre = (taxonomy?.genre?.title || taxonomy?.genre?.name || "").toLowerCase();
  const all = `${genre} ${themes}`;
  if (/makeup|make-up|grwm|cosmetic/.test(all)) return "make";
  if (/skincare|skin care|derma/.test(all)) return "skincare";
  if (/hair|cabelo/.test(all)) return "cabelo";
  if (/fragrance|perfume|scent/.test(all)) return "perfume";
  if (/tech|gadget|device/.test(all)) return "tech";
  if (/beauty/.test(all)) return "make";
  return "lifestyle";
}

export function nicheLabel(taxonomy) {
  const themes = (taxonomy?.themes ?? []).map((t) => t.title || t.name).filter(Boolean)
    .filter((t) => !/music|música/i.test(t)).slice(0, 2);
  const genre = taxonomy?.genre?.title || taxonomy?.genre?.name;
  return [genre, ...themes].filter(Boolean).join(" · ") || null;
}
