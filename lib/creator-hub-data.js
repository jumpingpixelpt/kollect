import { fetchPageRows, fetchPageIds } from "./page-data.js";
import { buildCreatorInsights } from "./creator-insights.js";

const PROFILE = "id,name,handle,platform,avatar_url,person_key";
const ACCOUNT = "id,name,handle,platform,avatar_url";
const VIDEO = "id,creator_id,url,title,thumb,posted_at,tipo,views,likes,comments,shares,saves,transcript";

// Leitura exclusiva das novas abas do Hub: recorte estrito, sem análises pagas,
// snapshots ou relatórios completos. Contas só se unem pelo vínculo manual existente.
export async function fetchCreatorHubInsights(db, id, options = {}) {
  const windowOptions = { ...options, hoje: options.hoje ?? new Date() };
  const { data: creator } = await db.from("leaderboard").select(PROFILE).eq("id", id).maybeSingle().throwOnError();
  if (!creator) return null;
  const linked = creator.person_key ? await fetchPageRows(() => db.from("leaderboard")
    .select(ACCOUNT).eq("person_key", creator.person_key).order("id")) : [];
  const accounts = [...new Map([creator, ...linked].map((account) => [account.id, account])).values()];
  const window = buildCreatorInsights([], windowOptions).window;
  const nextDay = new Date(`${window.end}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const videos = await fetchPageIds((ids) => db.from("videos").select(VIDEO).in("creator_id", ids)
    .gte("posted_at", window.start).lt("posted_at", nextDay.toISOString().slice(0, 10))
    .order("posted_at", { ascending: false }).order("id"), accounts.map((account) => account.id));
  const platforms = new Map(accounts.map((account) => [account.id, account.platform]));
  const insights = buildCreatorInsights(videos.map((video) => ({ ...video,
    platform: platforms.get(video.creator_id) || video.platform,
  })), windowOptions);
  return { ...insights, creator: {
    id: creator.id, name: creator.name, handle: creator.handle,
    avatar_url: creator.avatar_url, platform: creator.platform,
    accounts: accounts.map((account) => ({ id: account.id, handle: account.handle, platform: account.platform })),
  } };
}
