import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getVideosByCreator } from "@/lib/tubular";
import { internalJson, internalHeaders } from "@/lib/internal-fetch";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET ?n=10 — promove os top prospects pro radar:
 * resolve o handle real via oembed/embed dos vídeos e dispara a avaliação.
 */
export async function GET(req) {
  // Promover UM prospect (?tubular_id=) fica aberto a qualquer sessão desde a rodada 2
  // (F3.2, set/2026): o botão «Analisar» do Creators Hub chama-o, e custa o mesmo que o
  // «Avaliar perfil pelo link», que o operador já tinha. O LOTE (sem tubular_id, ?n=) é
  // área de Gestão — um operador não pode disparar dezenas de promoções pagas de uma vez.
  if (!new URL(req.url).searchParams.get("tubular_id") && !(await autorizadoAdmin(req))) {
    return NextResponse.json(SO_ADMIN, { status: 403 });
  }
  try { return await run(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

// Uma palavra por promoção, para o resumo da corrida caber no ecrã e ainda assim dizer se a
// audiência veio, se já lá estava, ou se ficou por comprar — e porquê.
function resumoAud(a) {
  if (!a) return null;
  if (a.atualizada) return "ok";
  if (a.saltada) return "já tinha";
  if (a.sem_audiencia) return "sem dados no IC";
  return `falhou: ${String(a.error || a.erro || "?").slice(0, 60)}`;
}

async function resolveHandle(vids) {
  for (const v of vids) {
    const url = v.video_url || "";
    try {
      if (v.platform === "tiktok") {
        const m = url.match(/video\/(\d+)/);
        if (!m) continue;
        const oe = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@redirect-to/video/${m[1]}`)}`).then((r) => r.json());
        const h = oe?.author_unique_id || (oe?.author_url || "").match(/@([\w.\-]+)/)?.[1];
        if (h) return { platform: "tiktok", handle: h };
      }
      if (v.platform === "instagram") {
        const m = url.match(/\/(p|reel|reels)\/([\w-]+)/);
        if (!m) continue;
        const html = await fetch(`https://www.instagram.com/p/${m[2]}/embed/captioned/`, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        }).then((r) => r.text());
        const h = html.match(/"username"\s*:\s*"([\w.\-]+)"/)?.[1] || html.match(/instagram\.com\/([\w.\-]+)\/?"[^>]*class="[^"]*Username/i)?.[1];
        if (h) return { platform: "instagram", handle: h };
      }
    } catch {}
  }
  return null;
}

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const dry = sp.get("dry");
  const n = Number(sp.get("n")) || 10;
  const fmin = sp.get("fmin") ? Number(sp.get("fmin")) : null;
  const fmax = sp.get("fmax") ? Number(sp.get("fmax")) : null;
  const emin = sp.get("emin") ? Number(sp.get("emin")) : null;
  // Mesmo racional do ?genre= no resolve-handles e do ?briefing= no collect: um casting
  // promove o SEU corte sem pagar Apify pelo topo global — sem isto, o batch por mini_score
  // promovia lifestyle e beauty antes de chegar ao health (308/283/208 no corte ≥70, ago/2026).
  const genre = sp.get("genre") || null;
  const mmin = sp.get("mmin") ? Number(sp.get("mmin")) : null;
  const light = sp.get("light");
  const icbulk = sp.get("icbulk");
  const t0 = Date.now();
  const base = new URL(req.url).origin;
  const db = supabaseAdmin();
  const unico = sp.get("tubular_id");

  // ─── roteamento de promoção: POR PLATAFORMA, não por fornecedor ───────────
  //
  // Até jul/2026 a primeira regra aqui era `fonte === "influencers_club" || handle` →
  // promote-ic. Ou seja: TODO prospect com handle ia para o influencers.club. Com a chave
  // do IC a devolver 401 (item A1 de docs/acoes-cliente-kollect.md) isso passou a falhar
  // fechado, e qualquer descoberta nova — que por desenho traz handle — nascia impromovível.
  //
  // O IC deixa de ser caminho de promoção. Fica reservado à demografia de audiência, que é
  // o único dado que só ele tem, e essa entra pelo audience-refresh, não por aqui. Quem
  // decide a rota é a PLATAFORMA do prospect, porque é isso que determina o actor do Apify.
  if (unico) {
    const { data: pr } = await db.from("prospects").select("fonte, handle, platform, post_url").eq("tubular_id", unico).maybeSingle();
    let plat = pr?.platform === "tiktok" ? "tiktok" : pr?.platform === "instagram" ? "instagram" : null;

    // Handle-lixo de extratores antigos: "p"/"reel"/"stories" são segmentos de URL de post
    // (instagram.com/p/CODE) gravados como username por um regex legado — 61 prospects a
    // 02/ago/2026, incluindo mini-scores 80+ ("David Rodrigues" 270k, calvície). Com o lixo
    // no lugar do @, o promote-apify raspava instagram.com/p e devolvia "perfil sem dados".
    // Tratar como AUSENTE deixa a promoção cair no caminho de resolução pelo post, que
    // extrai o username verdadeiro do embed.
    const JUNK = new Set(["p", "reel", "reels", "stories", "explore"]);
    if (pr?.handle && JUNK.has(pr.handle.toLowerCase())) pr.handle = null;

    // Sem @, mas COM o post que o descobriu: resolver pelo post, que é determinístico.
    //
    // O caminho antigo para estes prospects era Tubular (getVideosByCreator) → resolveHandle,
    // que no Instagram lê o @ de `instagram.com/p/CODE/embed/captioned/`. Esse embed deixou de
    // devolver o autor — hoje serve a mesma app shell de 600 kB para qualquer post, incluindo
    // os de perfis cujo @ já conhecemos (verificado a 03/ago/2026). Resultado: o botão dizia
    // "handle não resolvido" e gravava `sem_handle`, terminal, o que TAMBÉM os tirava da fila
    // do resolve-handles — o único resolvedor que ainda funciona, porque lê o @ do post via
    // Apify. Os dois caminhos nunca se encontravam: 366 prospects presos assim (207 IG + 159
    // TikTok), 133 deles do briefing capilar.
    if (!pr?.handle && pr?.post_url) {
      await internalJson(`${base}/api/resolve-handles?tubular_id=${encodeURIComponent(unico)}&n=1`,
        { nome: "resolve-handles", timeout: 200000 });
      const { data: pr2 } = await db.from("prospects").select("handle, platform").eq("tubular_id", unico).maybeSingle();
      if (pr2?.handle && !JUNK.has(pr2.handle.toLowerCase())) {
        pr.handle = pr2.handle;
        plat = pr2.platform === "tiktok" ? "tiktok" : pr2.platform === "instagram" ? "instagram" : plat;
      }
    }

    if (pr?.handle && plat === "tiktok") {
      const j = await internalJson(`${base}/api/promote-tiktok?handle=${encodeURIComponent(pr.handle)}&tubular_id=${encodeURIComponent(unico)}`, { nome: "promote-tiktok" });
      return NextResponse.json({ rota: "tiktok (apify)", ...j }, { status: 200 });
    }
    // Instagram com handle, ou handle sem plataforma declarada: o promote-apify salta a
    // resolução do @ pelo nome quando recebe ?handle=, e é essa resolução por nome que
    // produzia os `apify:homonima_suspeita`.
    if (pr?.handle) {
      const j = await internalJson(`${base}/api/promote-apify?tubular_id=${encodeURIComponent(unico)}&handle=${encodeURIComponent(pr.handle)}`, { nome: "promote-apify" });
      return NextResponse.json({ rota: "instagram (apify, handle directo)", ...j }, { status: 200 });
    }
    // sem handle: testa a cota da Tubular com 1 chamada barata antes de insistir
    try {
      await getVideosByCreator(unico, { platforms: ["tiktok", "instagram"], size: 1, daysBack: 30 });
    } catch (e) {
      if (/429|quota|410|deprecated/i.test(String(e))) {
        const j = await internalJson(`${base}/api/promote-apify?tubular_id=${encodeURIComponent(unico)}`, { nome: "promote-apify" });
        return NextResponse.json({ rota: "apify (Tubular indisponível)", ...j }, { status: 200 });
      }
    }
  }

  const q = db.from("prospects").select("tubular_id, name, handle, fonte, platform");
  let top;
  if (unico) {
    ({ data: top } = await q.eq("tubular_id", unico));
  } else {
    // `status.eq.sem_handle` (sem sufixo) continua a ser repescado — falhou uma vez, merece
    // outra. Os `sem_handle:irrecuperavel:<data>` não casam com o eq e ficam de fora do lote,
    // que é o efeito pretendido: já foram re-testados e não resolvem (docs/handles-irrecuperaveis.md).
    let qq = q.or("status.eq.novo,status.eq.sem_handle,status.like.vids*,status.like.handle*,status.like.falha*,status.like.erro*");
    if (fmin != null) qq = qq.gte("followers", fmin);
    if (fmax != null) qq = qq.lte("followers", fmax);
    if (emin != null) qq = qq.gte("eng_rate", emin);
    if (genre) qq = qq.eq("genre", genre);
    if (mmin != null) qq = qq.gte("mini_score", mmin);
    if (icbulk) qq = qq.not("handle", "is", null);
    const off = sp.get("off") ? Number(sp.get("off")) : 0;
    ({ data: top } = await qq.order("mini_score", { ascending: false }).order("tubular_id", { ascending: true }).range(off, off + n - 1));
  }
  if (!top?.length) return NextResponse.json({ error: "sem prospects novos" }, { status: 200 });

  const out = [];
  const CONC = sp.get("conc") ? Number(sp.get("conc")) : 4;
  let _qi = 0;

  /**
   * Demografia de audiência de quem acabou de entrar no radar — automática, por decisão do
   * cliente (jul/2026): a análise de audiência corre nos dois caminhos de entrada, este e o
   * "Avaliar perfil" (que a apanha pela cadeia do /api/enrich).
   *
   * Vai por HTTP à rota que já sabe fazê-lo em vez de repetir aqui a chamada ao IC, e é ela
   * que traz a idempotência e o piso de créditos: para quem entra por promote-apify, que já
   * comprou a audiência com o growth trimestral na mesma chamada, isto sai a custo zero; para
   * quem entra por promote-tiktok, que nunca comprou nenhuma, custa 1 crédito. Sem saldo
   * acima do piso, salta — a promoção não pode falhar por causa de um complemento.
   */
  async function audiencia(creatorId) {
    if (!creatorId) return null;
    return await fetch(`${base}/api/audience-refresh?id=${encodeURIComponent(creatorId)}`, {
      headers: internalHeaders(), signal: AbortSignal.timeout(120000),
    }).then((x) => x.json()).catch((e) => ({ error: String(e).slice(0, 80) }));
  }
  async function _worker() {
    while (true) {
      if (Date.now() - t0 > 240000) break;
      const p = top[_qi++];
      if (!p) break;
    try {
      // Mesmo roteamento por plataforma do caminho de um prospect (ver o comentário no topo
      // de run()). Estava só lá em cima: o lote continuava a mandar tudo o que tem handle
      // para o promote-ic — a rota que devolve 401 desde que a chave do IC morreu.
      if (p.handle) {
        const rota = p.platform === "tiktok"
          ? `${base}/api/promote-tiktok?handle=${encodeURIComponent(p.handle)}&tubular_id=${encodeURIComponent(p.tubular_id)}`
          : `${base}/api/promote-apify?tubular_id=${encodeURIComponent(p.tubular_id)}&handle=${encodeURIComponent(p.handle)}`;
        const via = p.platform === "tiktok" ? "tiktok" : "apify";
        const r = await fetch(rota, { headers: internalHeaders(), signal: AbortSignal.timeout(280000) }).then((x) => x.json()).catch((e) => ({ error: String(e).slice(0, 80) }));
        if (r?.ok || r?.creator_id) {
          const aud = await audiencia(r.creator_id);
          out.push({ name: p.name, ok: true, handle: p.handle, via, creator_id: r.creator_id, audiencia: resumoAud(aud) });
        } else {
          out.push({ name: p.name, ok: false, via, motivo: r?.error || `${via} falhou` });
        }
        continue;
      }
      let vids;
      for (let tent = 0; tent < 2; tent++) {
        try { vids = await getVideosByCreator(p.tubular_id, { platforms: ["tiktok", "instagram"], size: 12, daysBack: 365 }); break; }
        catch (e) { if (tent === 1) throw e; await new Promise((r) => setTimeout(r, 2000)); }
      }
      const resolved = await resolveHandle(vids || []);
      await db.from("prospects").update({ status: `vids:${(vids || []).length}` }).eq("tubular_id", p.tubular_id);
      if (!resolved) {
        await db.from("prospects").update({ status: "sem_handle" }).eq("tubular_id", p.tubular_id);
        out.push({ name: p.name, ok: false, motivo: "handle não resolvido" });
        continue;
      }
      await db.from("prospects").update({ status: `handle:${resolved.platform}/${resolved.handle}` }).eq("tubular_id", p.tubular_id);
      if (dry) { out.push({ name: p.name, resolved }); continue; }
      const profileUrl = resolved.platform === "tiktok"
        ? `https://www.tiktok.com/@${resolved.handle}`
        : `https://www.instagram.com/${resolved.handle}/`;
      const ev = await fetch(`${base}/api/evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json", ...internalHeaders() },
        body: JSON.stringify({ url: profileUrl }),
        signal: AbortSignal.timeout(60000),
      }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 80) }));
      if (ev?.id) {
        await db.from("prospects").update({ status: "promovido" }).eq("tubular_id", p.tubular_id);
        if (light) {
          await fetch(`${base}/api/brand-scan?handle=${encodeURIComponent(resolved.handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(90000) }).then((r) => r.json()).catch(() => {});
          await fetch(`${base}/api/kol-screen?handle=${encodeURIComponent(resolved.handle)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(60000) }).then((r) => r.json()).catch(() => {});
        }
        const aud = await audiencia(ev.id);
        out.push({ name: p.name, ok: true, handle: resolved.handle, platform: resolved.platform, creator_id: ev.id, audiencia: resumoAud(aud) });
      } else {
        await db.from("prospects").update({ status: `falha_eval:${(ev?.error || "?").slice(0, 60)}` }).eq("tubular_id", p.tubular_id);
        out.push({ name: p.name, ok: false, handle: resolved.handle, motivo: ev?.error || "avaliação falhou" });
      }
    } catch (e) {
      await db.from("prospects").update({ status: `erro:${String(e).slice(0, 60)}` }).eq("tubular_id", p.tubular_id).then(() => {});
      out.push({ name: p.name, ok: false, motivo: String(e).slice(0, 80) });
    }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONC, top.length)) }, () => _worker()));
  return NextResponse.json({ promovidos: out.filter((o) => o.ok).length, detalhes: out });
}
