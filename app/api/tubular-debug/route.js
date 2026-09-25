import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
export const dynamic = "force-dynamic";

// GET /api/tubular-debug?search=camilacoelho | ?id=ItbcduzUv3 | ?videos_from_creator=ItbcduzUv3
export async function GET(request) {
  if (!(await autorizadoAdmin(request))) return NextResponse.json(SO_ADMIN, { status: 403 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const search = searchParams.get("search");
  const videosFromCreator = searchParams.get("videos_from_creator");
  const apiKey = process.env.TUBULAR_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "TUBULAR_API_KEY missing" });

  // atalho: ?probe_accounts=termo — creator.search com accounts
  const probe = searchParams.get("probe_accounts");
  if (probe) {
    const r = await fetch("https://tubularlabs.com/api/v4/creator.search", {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ include: { search: probe }, fields: { snippet: true, performance: true, taxonomy: true, accounts: true }, scroll: { size: 2 } }),
    });
    const t = await r.text();
    return NextResponse.json({ status: r.status, body: tryJson(t) });
  }

  // testa chaves de filtro candidatas no v3 creator.search: ?fkeys=1|2
  const fkeys = searchParams.get("fkeys");
  if (fkeys) {
    const g1 = {
      creator_views: { min: 0, max: 1000000 },
      creator_uploads_90d: { min: 1, max: 50 },
      creator_followers: { min: 1000, max: 10000 },
      creator_last_upload_date: { min: "2026-05-01", max: "2026-06-12" },
      creator_languages: ["pt"],
    };
    const g2 = {
      creator_types: ["influencer"],
      creator_platforms: ["tiktok"],
      creator_topics: [1],
      creator_industries: [1],
      creator_video_views_30d: { min: 0, max: 100000 },
    };
    const cands = fkeys === "2" ? g2 : g1;
    const out = {};
    for (const [k, val] of Object.entries(cands)) {
      const body = { query: { include_filter: { creator_genres: [23], creator_countries: ["BR"], [k]: val } }, fields: ["creator_id"], scroll: { scroll_size: 1 } };
      const r = await fetch("https://tubularlabs.com/api/v3/creator.search", { method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = tryJson(await r.text());
      out[k] = { status: r.status, total: j?.total, err: r.ok ? undefined : (j?.error || "").slice(0, 120) };
      await new Promise((s) => setTimeout(s, 1100));
    }
    return NextResponse.json(out);
  }

  // descobre filtros válidos do v3 creator.search: ?v3filters=1
  if (searchParams.get("v3filters")) {
    const r = await fetch("https://tubularlabs.com/api/v3/creator.search", {
      method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { include_filter: { chave_invalida_xyz: 1 } }, scroll: { scroll_size: 1 } }),
    });
    const j = tryJson(await r.text());
    return NextResponse.json({ status: r.status, body: j });
  }

  // probe v3 creator.search + scroll: ?v3c=1&n=3&pages=3&mode=full|bare
  const v3c = searchParams.get("v3c");
  if (v3c) {
    const n = Number(searchParams.get("n")) || 3;
    const pages = Number(searchParams.get("pages")) || 3;
    const mode = searchParams.get("mode") || "full";
    let token = null, firstToken = null;
    const out = [];
    for (let i = 0; i < pages; i++) {
      const useToken = mode === "first" ? firstToken : token;
      const body = useToken && mode === "bare"
        ? { scroll: { scroll_size: n, scroll_token: useToken } }
        : {
            query: { include_filter: { creator_genres: [23], creator_countries: ["BR"] } },
            fields: ["creator_id", "title", "country", "genre", "views", "uploads_90d"],
            scroll: useToken ? { scroll_size: n, scroll_token: useToken } : { scroll_size: n },
          };
      const r = await fetch("https://tubularlabs.com/api/v3/creator.search", { method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = tryJson(await r.text());
      const newToken = j?.scroll_token ?? null;
      if (!firstToken && newToken) firstToken = newToken;
      const list = j?.creators || j?.results || [];
      out.push({ page: i + 1, status: r.status, total: j?.total, qtd: list.length, primeiro: list[0]?.creator_id, ultimo: list.at(-1)?.creator_id, token_mudou: newToken !== token, err: r.ok ? undefined : JSON.stringify(j).slice(0, 300) });
      token = newToken;
      if (!newToken || !r.ok) break;
      await new Promise((s) => setTimeout(s, 1100));
    }
    return NextResponse.json({ modo: mode, paginas: out });
  }

  // probe de enumeração via vídeos: ?vprobe=2026-06-08,2026-06-10&n=3
  const vprobe = searchParams.get("vprobe");
  if (vprobe) {
    const [mn, mx] = vprobe.split(",");
    const n = Number(searchParams.get("n")) || 3;
    const mk = (filtros) => ({ query: { include_filter: { ...filtros, video_upload_date: { min: mn, max: mx } } }, fields: ["publisher", "platform"], scroll: { scroll_size: n } });
    const tries = {
      genres_countries: mk({ video_genres: [23], creator_countries: ["BR"] }),
      genres_only: mk({ video_genres: [23] }),
    };
    const out = {};
    for (const [k, body] of Object.entries(tries)) {
      const r = await fetch("https://tubularlabs.com/api/v3/video.search", { method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = tryJson(await r.text());
      out[k] = { status: r.status, total: j?.total ?? j?.total_results, sample: (j?.videos || j?.results || []).slice(0, 3).map((v) => v.publisher), err: r.ok ? undefined : JSON.stringify(j).slice(0, 250) };
      await new Promise((s) => setTimeout(s, 1100));
    }
    return NextResponse.json(out);
  }

  // probe de variantes de filtro de followers: ?fmulti=10000,20000
  const fmulti = searchParams.get("fmulti");
  if (fmulti) {
    const [mn, mx] = fmulti.split(",").map(Number);
    const base = { fields: { performance: true }, scroll: { size: 2 } };
    const tries = {
      include_followers_minmax: { include: { genres: [23], countries: ["BR"], followers_min: mn, followers_max: mx }, ...base },
      include_performance: { include: { genres: [23], countries: ["BR"], performance: { followers: { min: mn, max: mx } } }, ...base },
      filter_toplevel: { include: { genres: [23], countries: ["BR"] }, filter: { followers: { min: mn, max: mx } }, ...base },
      include_creator_sizes: { include: { genres: [23], countries: ["BR"], creator_sizes: ["10k-100k"] }, ...base },
    };
    const out = {};
    for (const [k, body] of Object.entries(tries)) {
      const r = await fetch("https://tubularlabs.com/api/v4/creator.search", { method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = tryJson(await r.text());
      out[k] = { status: r.status, total: j?.total, followers: (j?.results || []).map((x) => x.performance?.followers), err: r.ok ? undefined : JSON.stringify(j).slice(0, 250) };
      await new Promise((s) => setTimeout(s, 1100));
    }
    return NextResponse.json(out);
  }

  // probe de filtro por seguidores: ?fprobe=10000,20000  | probe de sort: ?sprobe=followers
  const fprobe = searchParams.get("fprobe");
  const sprobe = searchParams.get("sprobe");
  if (fprobe || sprobe) {
    const body = { include: { genres: [23], countries: ["BR"] }, fields: { performance: true }, scroll: { size: 2 } };
    if (fprobe) { const [mn, mx] = fprobe.split(",").map(Number); body.include.followers = { min: mn, max: mx }; }
    if (sprobe) body.sort = { sort: sprobe, sort_reverse: true };
    const r = await fetch("https://tubularlabs.com/api/v4/creator.search", {
      method: "POST", headers: { "Api-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = tryJson(await r.text());
    return NextResponse.json({ status: r.status, total: j?.total, followers_vistos: (j?.results || []).map((x) => x.performance?.followers), err: r.ok ? undefined : JSON.stringify(j).slice(0, 300) });
  }

  // teste de paginação: ?scrolltest=full|bare|nosize&size=3&pages=4
  const scrolltest = searchParams.get("scrolltest");
  if (scrolltest) {
    const size = Number(searchParams.get("size")) || 3;
    const pages = Number(searchParams.get("pages")) || 4;
    let token = null;
    const out = [];
    for (let i = 0; i < pages; i++) {
      const body = token && scrolltest === "bare"
        ? { scroll: { size, token } }
        : token && scrolltest === "nosize"
          ? { scroll: { token } }
          : { include: { genres: [23], countries: ["BR"] }, scroll: token ? { size, token } : { size } };
      const r = await fetch("https://tubularlabs.com/api/v4/creator.search", {
        method: "POST",
        headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = tryJson(await r.text());
      token = j?.scroll?.token ?? null;
      out.push({ page: i + 1, status: r.status, ids: (j?.results || []).map((x) => x.id), tem_token: !!token, err: r.ok ? undefined : JSON.stringify(j).slice(0, 200) });
      if (!token) break;
      await new Promise((s) => setTimeout(s, 1100));
    }
    return NextResponse.json({ modo: scrolltest, paginas: out });
  }

  // modo genérico: ?endpoint=/v4/creator.trends&body={"creator_ids":["x"]}
  const rawEndpoint = searchParams.get("endpoint");
  if (rawEndpoint) {
    // só /v3|v4/<recurso>: nada de host, userinfo ou query a redirigir a chave (pentest set/2026, SSRF)
    if (!/^\/v[34]\/[a-z][a-z0-9_.-]*$/i.test(rawEndpoint)) return NextResponse.json({ error: "endpoint inválido — formato /v4/recurso.acao" }, { status: 200 });
    let genericBody = {};
    try { genericBody = JSON.parse(searchParams.get("body") || "{}"); } catch {}
    const r = await fetch(`https://tubularlabs.com/api${rawEndpoint}`, {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(genericBody),
    });
    const t = await r.text();
    return NextResponse.json({ request: { endpoint: rawEndpoint, body: genericBody }, response: { status: r.status, ok: r.ok, body: tryJson(t) } });
  }

  let endpoint = "/v4/creator.search";
  let body;
  if (videosFromCreator) {
    endpoint = "/v3/video.search";
    const today = new Date().toISOString().slice(0, 10);
    const oneYearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    body = {
      query: { include_filter: { creators: [videosFromCreator], video_platforms: ["tiktok", "instagram", "youtube", "facebook"], video_upload_date: { min: oneYearAgo, max: today } } },
      fields: ["video_url", "title", "publisher", "views", "engagements", "publish_date", "platform"],
      sort: { sort: "views_gain", sort_reverse: true, sort_date_range: { min: oneYearAgo, max: today } },
      scroll: { scroll_size: 5 },
    };
  } else {
    const include = {};
    if (id) include.ids = [id];
    else if (search) include.search = search;
    else return NextResponse.json({ error: "passe ?id=, ?search= ou ?videos_from_creator=" });
    body = { include, fields: { snippet: true, taxonomy: true, performance: true }, scroll: { size: 5 } };
  }

  const res = await fetch(`https://tubularlabs.com/api${endpoint}`, {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return NextResponse.json({
    request: { url: `https://tubularlabs.com/api${endpoint}`, body },
    response: { status: res.status, ok: res.ok, body: tryJson(text) },
  });
}
function tryJson(s) { try { return JSON.parse(s); } catch { return s.slice(0, 2000); } }
