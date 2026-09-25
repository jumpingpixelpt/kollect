import { NextResponse } from "next/server";
import { podeGastar } from "@/lib/ic-budget";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE = "https://api-dashboard.influencers.club";

/**
 * Prober da API do influencers.club:
 *  ?credits=1                          — saldo de créditos (0 créditos)
 *  ?enrich=handle&platform=instagram   — enrich full (1 crédito) [&audience=1]
 *  ?endpoint=/public/v1/...&body={...} — genérico (GET se body ausente)
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req, { admin: true });
  if (bloqueio) return bloqueio;
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}

async function ic(path, body, method) {
  // só caminhos da API pública do IC: um ?endpoint=@outro.host ou //outro.host mudaria o
  // destino do pedido com a nossa chave (pentest set/2026, SSRF)
  if (!/^\/public\/v1\/[A-Za-z0-9_\/-]*$/.test(path)) throw new Error("endpoint fora de /public/v1/");
  const r = await fetch(`${BASE}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${process.env.INFLUENCERS_CLUB_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 1500); }
  return { status: r.status, ok: r.ok, body: j };
}

async function run(req) {
  if (!process.env.INFLUENCERS_CLUB_API_KEY) return NextResponse.json({ error: "INFLUENCERS_CLUB_API_KEY não configurada" }, { status: 200 });
  const sp = new URL(req.url).searchParams;

  if (sp.get("credits")) return NextResponse.json(await ic("/public/v1/accounts/credits/"));

  // Daqui para baixo é tudo pago. Uma rota de debug gasta créditos exactamente iguais aos da
  // produção — e foi a somar chamadas "só para ver" que o plano anual se esvaziou. Mesmo piso
  // de lib/ic-budget.js que as rotas reais; ?credits=1 acima continua a custar 0.
  const orc = await podeGastar(1);
  if (!orc.ok) return NextResponse.json({ error: orc.motivo, saldo_ic: orc.saldo }, { status: 200 });

  const enrich = sp.get("enrich");
  if (enrich) {
    const body = { handle: enrich, platform: sp.get("platform") || "instagram" };
    if (sp.get("audience")) body.include_audience_data = true;
    if (sp.get("lookalikes")) body.include_lookalikes = true;
    return NextResponse.json(await ic("/public/v1/creators/enrich/handle/full/", body));
  }

  // probe de discovery: ?disco=1&ai=skincare&cap=cabelo ralo,cabelo caindo&loc=Brazil&min=10000&max=200000&n=5&sort=growth_rate
  if (sp.get("disco")) {
    const loc = sp.get("loc"), min = Number(sp.get("min")) || undefined, max = Number(sp.get("max")) || undefined;
    const n = Number(sp.get("n")) || 5;
    const filters = {};
    if (min || max) filters.number_of_followers = { min, max };
    if (loc) filters.location = [loc];
    if (sp.get("bio")) filters.keywords_in_bio = sp.get("bio").split(",").map((s) => s.trim());
    if (sp.get("cap")) filters.keywords_in_captions = sp.get("cap").split(",").map((s) => s.trim());
    if (sp.get("emin")) filters.engagement_percent = { min: Number(sp.get("emin")) };
    if (sp.get("ai")) filters.ai_search = sp.get("ai");
    if (sp.get("gkey")) filters[sp.get("gkey")] = { min: Number(sp.get("gmin")) || 0 };
    const body = {
      platform: sp.get("platform") || "instagram",
      paging: { limit: n, page: Number(sp.get("page")) || 0 },
      sort: { sort_by: sp.get("sort") || "relevancy", sort_order: "desc" },
      filters: Object.keys(filters).length ? filters : null,
    };
    const r = await ic("/public/v1/discovery/", body);
    // ?raw=1 devolve o primeiro account completo (pra mapear campos)
    if (sp.get("raw") && r.body?.accounts) {
      return NextResponse.json({ request: body, total: r.body.total, primeiro_account_completo: r.body.accounts[0] });
    }
    // resume os accounts pra resposta caber
    if (r.body?.accounts) {
      r.body = {
        total: r.body.total, limit: r.body.limit, credits_left: r.body.credits_left,
        accounts: r.body.accounts.map((a) => ({
          username: a.profile?.username, nome: a.profile?.full_name,
          followers: a.profile?.followers, eng: a.profile?.engagement_percent,
        })),
      };
    }
    return NextResponse.json({ request: body, response: r });
  }

  const endpoint = sp.get("endpoint");
  if (endpoint) {
    let body = null;
    try { body = sp.get("body") ? JSON.parse(sp.get("body")) : null; } catch {}
    return NextResponse.json(await ic(endpoint, body));
  }

  return NextResponse.json({ uso: "?credits=1 | ?enrich=handle&platform=instagram|tiktok [&audience=1] | ?endpoint=&body=" });
}
