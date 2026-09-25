import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { bandaDe, volumeConversa, conteudoConversa, leituraConversa } from "@/lib/conversa";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * CONVERSA COM A COMUNIDADE — grava `creators.conversa` (feedback do cliente, set/2026,
 * ponto 14: no lugar de "autoridade social" e "aderência de audiência", medir se a audiência
 * trata a creator como fonte — comentários, perguntas, respostas).
 *
 * GET ?handle=xxx [&pecas=4] [&por_peca=40] [&so_volume=1]
 *   · volume (grátis): média de comentários por peça, por 1k seguidores, consistência entre
 *     peças e comparação com a mediana da faixa de seguidores (view conversa_bench), tudo a
 *     partir das peças já no banco.
 *   · conteúdo (paga Apify): raspa os comentários das últimas `pecas` peças com URL —
 *     TikTok clockworks/tiktok-comments-scraper (~US$ 0,001/comentário), Instagram
 *     apify/instagram-comment-scraper (~US$ 0,0023/comentário) — e conta perguntas, pedidos
 *     de recomendação e respostas da própria creator. 4 peças × 40 comentários + respostas
 *     ≈ US$ 0,20 (TikTok) a US$ 0,45 (Instagram) por creator. Por isso entra na cadeia só
 *     para quem passa o corte do Score KOL, como o deep-scan, e `so_volume=1` é o caminho
 *     grátis para a base inteira.
 *
 * GET ?lote=200[&offset=0] — volume para todos os creators (grátis, admin/bearer via
 * middleware): o casting mostra "comentários por peça" para toda a gente.
 *
 * O texto dos comentários é de terceiros: não fica gravado. Ficam agregados e três
 * exemplos curtos de perguntas, sem autor, como evidência do que se contou.
 */
async function apify(actor, input, timeout = 180) {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&timeout=${timeout}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`apify ${actor} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return Array.isArray(j) ? j : [];
}

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "conversa", max: 20, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

async function benchDe(db, followers) {
  const { data } = await db.from("conversa_bench").select("*").eq("band", bandaDe(followers)).maybeSingle();
  return data ?? null;
}

async function run(req) {
  const sp = new URL(req.url).searchParams;
  const db = supabaseAdmin();

  // ── lote: só volume, para a base inteira ──
  if (sp.get("lote")) {
    const lote = Math.min(Math.max(Number(sp.get("lote")) || 200, 1), 500);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const { data: creators, count } = await db.from("creators").select("id, handle, followers, conversa", { count: "exact" }).order("id").range(offset, offset + lote - 1);
    const { data: benchRows } = await db.from("conversa_bench").select("*");
    const benchBy = Object.fromEntries((benchRows ?? []).map((b) => [b.band, b]));
    let gravados = 0, semPecas = 0;
    for (const c of creators ?? []) {
      const { data: vids } = await db.from("videos").select("comments, tipo").eq("creator_id", c.id);
      const volume = volumeConversa(vids ?? [], c.followers, benchBy[bandaDe(c.followers)]);
      if (!volume) { semPecas++; continue; }
      const conteudo = c.conversa?.conteudo ?? null; // não se perde o que já foi raspado
      const { error } = await db.from("creators").update({ conversa: { ...(c.conversa || {}), volume, conteudo, leitura: leituraConversa(volume, conteudo), volume_em: new Date().toISOString().slice(0, 10) } }).eq("id", c.id);
      if (!error) gravados++;
    }
    const proximo = offset + (creators?.length ?? 0);
    return NextResponse.json({ lote, offset, processados: creators?.length ?? 0, gravados, sem_pecas: semPecas, total: count, restantes: Math.max(0, (count ?? 0) - proximo), proximo_offset: proximo, versao: "2026-09-11a" });
  }

  const handle = (sp.get("handle") || "").trim().replace(/^@/, "");
  if (!handle) return NextResponse.json({ error: "falta ?handle=" }, { status: 200 });
  // 3 × 30 por omissão: no Instagram as respostas vêm achatadas e contam como comentário
  // cobrado — 2 peças × 20 devolveram 98 itens no piloto (~US$ 0,23); 3 × 30 fica em
  // ~US$ 0,3–0,6 por creator de Instagram e ~US$ 0,15 no TikTok.
  const nPecas = Math.min(Math.max(Number(sp.get("pecas")) || 3, 1), 10);
  const porPeca = Math.min(Math.max(Number(sp.get("por_peca")) || 30, 5), 200);
  const soVolume = sp.get("so_volume") === "1";

  const { data: c } = await db.from("creators").select("id, handle, platform, followers, conversa").eq("handle", handle).maybeSingle();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });
  const { data: vids } = await db.from("videos").select("url, comments, tipo, posted_at").eq("creator_id", c.id).order("posted_at", { ascending: false });
  const volume = volumeConversa(vids ?? [], c.followers, await benchDe(db, c.followers));
  if (!volume) return NextResponse.json({ error: "sem peças com comentários no banco — corre /api/import-videos primeiro", handle }, { status: 200 });

  let conteudo = c.conversa?.conteudo ?? null;
  let amostra = c.conversa?.amostra ?? null;
  if (!soVolume) {
    if (!process.env.APIFY_TOKEN) return NextResponse.json({ error: "APIFY_TOKEN não configurado" }, { status: 200 });
    const pecas = (vids ?? []).filter((v) => v.url && (v.comments ?? 0) > 0 && v.tipo !== "imagem").slice(0, nPecas);
    if (!pecas.length) return NextResponse.json({ error: "sem peças com URL e comentários para ler", handle }, { status: 200 });
    const urls = pecas.map((v) => v.url);

    const comentarios = [];
    if (c.platform === "tiktok") {
      const items = await apify("clockworks~tiktok-comments-scraper", { postURLs: urls, commentsPerPost: porPeca, maxRepliesPerComment: 2 }, 240);
      for (const it of items) {
        const id = String(it.cid ?? it.id ?? "");
        const pai = it.repliesToId ?? it.replyToId ?? it.parentId ?? null;
        comentarios.push({ id, texto: String(it.text || ""), autor: it.uniqueId ?? it.user?.uniqueId ?? "", resposta_de: pai ? String(pai) : null });
        for (const r of Array.isArray(it.replies) ? it.replies : []) {
          comentarios.push({ id: String(r.cid ?? r.id ?? ""), texto: String(r.text || ""), autor: r.uniqueId ?? r.user?.uniqueId ?? "", resposta_de: id });
        }
      }
    } else {
      const items = await apify("apify~instagram-comment-scraper", { directUrls: urls, resultsLimit: porPeca, includeNestedComments: true }, 240);
      for (const it of items) {
        const id = String(it.id ?? "");
        comentarios.push({ id, texto: String(it.text || ""), autor: it.ownerUsername ?? "", resposta_de: null });
        for (const r of Array.isArray(it.replies) ? it.replies : []) {
          comentarios.push({ id: String(r.id ?? ""), texto: String(r.text || ""), autor: r.ownerUsername ?? "", resposta_de: id });
        }
      }
    }
    if (!comentarios.length) return NextResponse.json({ error: "o Apify não devolveu comentários (peças sem comentários públicos ou perfil privado)", handle, pecas: urls.length }, { status: 200 });
    conteudo = conteudoConversa(comentarios, c.handle);
    amostra = { pecas: urls, por_peca: porPeca, lidos: comentarios.length, em: new Date().toISOString().slice(0, 10) };
  }

  const conversa = { volume, conteudo, amostra, leitura: leituraConversa(volume, conteudo), volume_em: new Date().toISOString().slice(0, 10) };
  const { error } = await db.from("creators").update({ conversa }).eq("id", c.id);
  if (error) return NextResponse.json({ error: `conversa não gravada: ${error.message}` }, { status: 200 });
  return NextResponse.json({ handle, ...conversa, versao: "2026-09-11a" });
}
