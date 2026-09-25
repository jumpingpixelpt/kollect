import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { internalHeaders } from "@/lib/internal-fetch";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET ?handle=xxx — varredura profunda v3 (processo multimodal, estilo tokforge):
 * Apify baixa cada URL específica → upload pro Gemini File API → o Gemini assiste o vídeo
 * INTEIRO (imagem + áudio) e devolve numa só chamada: transcrição com timestamps, hook,
 * ritmo de edição, estrutura narrativa, texto na tela, estilo visual, áudio, viral score
 * E as dimensões próprias do KOLLECT (expertise/originalidade/didática/brand_safety/
 * content_score/temas/veredicto + marcas citadas). Depois recalcula o score.
 *
 * Regra de negócio preservada: vídeo sem fala não pontua Autoridade (content_score null),
 * mas agora a análise visual é gravada mesmo assim e transcript="" evita reprocessamento.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com";

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "deep-scan", max: 10, janelaMs: 60_000 });
  if (travado) return travado;
  try { return await scan(req); } catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 300) }, { status: 200 }); }
}

async function scan(req) {
  const { APIFY_TOKEN, GEMINI_KEY } = process.env;
  // gemini-2.5-flash por omissão (decisão do Rui, 01/08/2026): a análise é a mesma em
  // pipeline e campos, custa ~4-5× menos e tem 10× a quota diária (10.000 vs 1.000 no
  // Tier 1) — foi o teto de 1.000/dia do pro a parar a importação do casting capilar a
  // meio. RESSALVA DE COMPARABILIDADE: as análises até esta data foram do 2.5-pro e o
  // flash comprime as notas para o meio; o campo `engine` gravado em cada análise diz
  // quem pontuou o quê. Para voltar ao pro num creator: GEMINI_MODEL no ambiente.
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!APIFY_TOKEN || !GEMINI_KEY)
    return NextResponse.json({ error: "faltam chaves (APIFY_TOKEN/GEMINI_KEY)" }, { status: 200 });

  const sp = new URL(req.url).searchParams;
  const handle = sp.get("handle");
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("id, handle, platform, name, niche").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 200 });

  // 3 por omissão (decisão do Rui, 10/09/2026, para baixar o custo por creator): o
  // deep-scan é ~75% do custo de enriquecer, e a parcela que pesa é o Apify a ir buscar
  // cada ficheiro (~US$ 0,045 por vídeo), não o Gemini flash (~US$ 0,015). Passar a "só
  // transcrição" pouparia ~25% do deep-scan; passar de 6 para 3 vídeos poupa metade —
  // ~US$ 0,18 por creator. O que se perde é leitura: Autoridade e temas ficam a assentar
  // em 3 peças em vez de 6, e um vídeo sem fala pesa um terço da amostra. Quem quiser a
  // análise completa (finalistas, ficha) passa ?limite=6 ou ?limite=8.
  //
  // História do número: o tecto era 5 e a importação por link grava 8 peças — a primeira
  // análise deixava sempre 3 vídeos sem score nem chat e obrigava a uma segunda passagem
  // manual que ninguém adivinhava ser precisa; por isso subiu a 8. Em ago/2026 (casting
  // capilar) desceu a 6 como equilíbrio entre custo e leitura para triagem em massa
  // (afinado no mesmo dia 8→4→6; a 260 creators, 6 em vez de 8 valeu ~$25-35). Como o
  // deep-scan pega sempre nos pendentes mais recentes, o link-import completa-se em
  // passagens seguintes. O processamento é em PARALELO (Promise.all abaixo), portanto o
  // tecto mexe no custo Apify/Gemini, quase nada no tempo de parede — o relógio é o
  // vídeo mais lento.
  const LIMITE_PADRAO = 3;
  const limite = Math.min(Math.max(Number(sp.get("limite")) || LIMITE_PADRAO, 1), 20);

  // alvos: vídeos do radar ainda sem transcrição, mais recentes primeiro.
  // tipo != imagem: desde set/2026 a tabela guarda também peças de imagem, importadas
  // pelas legendas para o brand-scan ler o território. Mandar uma foto ao Gemini para
  // transcrever é uma chamada paga a falhar.
  const { data: targets } = await db.from("videos")
    .select("id, url, title, views, posted_at")
    .eq("creator_id", c.id).not("url", "is", null).is("transcript", null).neq("tipo", "imagem")
    .order("posted_at", { ascending: false }).limit(limite);
  if (!targets?.length) return NextResponse.json({ error: "nenhum vídeo pendente de transcrição" }, { status: 200 });

  // Apify baixa as URLs específicas (normaliza o @redirect-to da Tubular pro handle real)
  const canon = (u) => {
    const m = (u || "").match(/video\/(\d+)/);
    return c.platform === "tiktok" && m ? `https://www.tiktok.com/@${c.handle}/video/${m[1]}` : u;
  };
  const urls = targets.map((t) => canon(t.url));
  const input = c.platform === "tiktok"
    ? { postURLs: urls, shouldDownloadVideos: true, resultsPerPage: urls.length }
    : { directUrls: urls, resultsType: "posts", searchType: "hashtag" };
  const actor = c.platform === "tiktok" ? "clockworks~tiktok-scraper" : "apify~instagram-scraper";
  const items = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=200`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  ).then((r) => r.json());
  if (!Array.isArray(items)) return NextResponse.json({ error: "apify falhou", got: items?.error?.message ?? items }, { status: 200 });

  const mediaByUrl = {};
  for (const it of items) {
    const page = it.webVideoUrl ?? it.url ?? it.inputUrl ?? "";
    const media = it.mediaUrls?.[0] ?? it.videoMeta?.downloadAddr ?? it.videoUrl ?? null;
    if (page && media) mediaByUrl[page.replace(/\/$/, "")] = media;
  }

  // processa os vídeos em PARALELO — cada um faz download → upload Gemini → análise → grava
  const results = await Promise.all(targets.map(async (t) => {
    const titulo = t.title?.slice(0, 50);
    const tid = (t.url.match(/video\/(\d+)/) || [])[1] || t.url.split("/").filter(Boolean).pop();
    const media = mediaByUrl[canon(t.url).replace(/\/$/, "")] ?? Object.entries(mediaByUrl).find(([k]) => k.includes(tid))?.[1];
    if (!media) return { titulo, ok: false, motivo: "apify não devolveu mídia" };
    let fileName = null;
    try {
      const m = await fetch(media);
      if (!m.ok) return { titulo, ok: false, motivo: `download ${m.status}` };
      const bytes = await m.arrayBuffer();

      // upload resumable pro Gemini File API (vídeo grande demais pra ir inline)
      const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${GEMINI_KEY}`, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
          "X-Goog-Upload-Header-Content-Type": "video/mp4",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: `kollect-${t.id}` } }),
      });
      const uploadUrl = start.headers.get("x-goog-upload-url");
      if (!uploadUrl) return { titulo, ok: false, motivo: `gemini upload start ${start.status}` };
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Length": String(bytes.byteLength), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
        body: bytes,
      }).then((r) => r.json());
      fileName = up.file?.name;
      const fileUri = up.file?.uri;
      if (!fileUri) return { titulo, ok: false, motivo: "gemini upload falhou" };

      // aguarda o processamento do arquivo (máx ~90s)
      let state = up.file.state;
      for (let i = 0; i < 30 && state !== "ACTIVE"; i++) {
        if (state === "FAILED") return { titulo, ok: false, motivo: "gemini processamento do vídeo falhou" };
        await new Promise((r) => setTimeout(r, 3000));
        state = (await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${GEMINI_KEY}`).then((r) => r.json())).state;
      }
      if (state !== "ACTIVE") return { titulo, ok: false, motivo: "timeout no processamento do vídeo" };

      const prompt = `Você analisa vídeos de creators de beleza para a KOLLECT (plataforma de descoberta de talentos da L'Oréal). Assista este vídeo COMPLETO, frame a frame E ouvindo todo o áudio, e responda APENAS com um JSON válido exatamente nesta estrutura:
{
 "hook": { "description": "o que acontece nos primeiros 3 segundos e por que prende (pt-BR)", "score": 0-100, "type": "Weak|Good|Strong" },
 "rhythm": { "cuts_per_second": número, "style": "Slow|Dynamic|Ultra-Fast" },
 "structure": [ { "block": "Hook|Problem|Solution|Social Proof|CTA", "start_second": n, "end_second": n } ],
 "onscreen_text": ["todo texto/legenda que aparece na tela, verbatim, na ordem"],
 "transcript": { "full_text": "transcrição completa e fiel de TODA a fala (verbatim)", "segments": [ { "text": "...", "start_second": n, "end_second": n, "speaker": "narrator|voiceover|person" } ] },
 "visual": { "dominant_colors": ["#hex", "até 4"], "camera_movement": "Static|Handheld|Fast Cuts", "framing": "Close-up|Medium|Wide" },
 "audio": { "energy": "Low|Medium|High", "bpm_estimate": número, "has_voice": true|false, "music_mood": "descrição curta (pt-BR)" },
 "viral_score": { "total": 0-100, "breakdown": { "hook_strength": 0-100, "edit_quality": 0-100, "structure_clarity": 0-100, "audio_energy": 0-100 } },
 "template": { "blocks": [ { "label": "nome do bloco (pt-BR)", "placeholder": "o que filmar nesse bloco (pt-BR)", "duration_seconds": n } ] },
 "category": "EXATAMENTE uma: Beauty|Fitness|Fashion|Food|Tech|Home|Health|Pets|Kids|Accessories|Books|Automotive|Other",
 "duration_seconds": número,
 "kollect": { "expertise": 0-10, "originalidade": 0-10, "didatica": 0-10, "brand_safety": 0-10, "content_score": 0-10, "temas": ["até 3 temas (pt-BR)"], "veredicto": "1 frase (pt-BR)", "marcas_citadas": [ { "marca": "nome", "contexto": "como aparece: falada, mostrada no vídeo ou texto na tela" } ] }
}
Definições KOLLECT: expertise = domínio técnico real de beauty; originalidade = voz própria vs. surfar trend; didatica = ensina e forma opinião; brand_safety = adequação a uma marca global; content_score = nota geral ponderada (0-10).
Transcreva cada palavra falada fielmente, com timestamps por segmento. Enums em inglês; textos descritivos em pt-BR; transcript e onscreen_text verbatim (nunca traduza). Se não houver fala: "full_text": "" e "has_voice": false.
Creator: ${c.name} (${c.niche}). Título do vídeo: ${t.title || "—"}`;

      const gen = await fetch(`${GEMINI_BASE}/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ file_data: { mime_type: "video/mp4", file_uri: fileUri } }, { text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 32768, responseMimeType: "application/json" },
        }),
      }).then((r) => r.json());
      const raw = (gen.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      let a = null;
      try { a = JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()); } catch {}
      // código e estado do erro entram no motivo: a quota diária de geração vem como
      // RESOURCE_EXHAUSTED/429 no `code`/`status`, não no texto — e é por aí que o
      // cron deep-scan-lote sabe que deve parar por hoje.
      if (!a) return { titulo, ok: false, motivo: `gemini sem JSON${gen.error ? ` ${gen.error.code ?? ""} ${gen.error.status ?? ""}`.trimEnd() : ""}: ${(gen.error?.message || raw).slice(0, 120)}` };

      const k = a.kollect || {};
      const full = (a.transcript?.full_text || "").trim();
      const semFala = a.audio?.has_voice === false || full.replace(/[♪♫\[\]()]/g, "").trim().length < 60;
      const analysis = {
        // dimensões KOLLECT (consumidas por score, hire-plan, briefing e páginas)
        expertise: semFala ? null : k.expertise ?? null,
        originalidade: semFala ? null : k.originalidade ?? null,
        didatica: semFala ? null : k.didatica ?? null,
        brand_safety: k.brand_safety ?? null,
        content_score: semFala ? null : k.content_score ?? null,
        temas: semFala ? [] : k.temas || [],
        veredicto: semFala ? "Vídeo sem fala (estético/musical) — não pontua Autoridade." : k.veredicto ?? null,
        marcas_citadas: k.marcas_citadas || [],
        // análise multimodal (processo tokforge)
        hook: a.hook ?? null,
        rhythm: a.rhythm ?? null,
        structure: a.structure || [],
        onscreen_text: a.onscreen_text || [],
        transcript_segments: a.transcript?.segments || [],
        visual: a.visual ?? null,
        audio: a.audio ?? null,
        viral_score: a.viral_score ?? null,
        template: a.template ?? null,
        category: a.category ?? null,
        duration_seconds: a.duration_seconds ?? null,
        engine: MODEL,
        analisado_em: new Date().toISOString().slice(0, 10),
      };

      await db.from("videos").update({
        transcript: semFala ? "" : full.slice(0, 8000), // "" (não null) pra não reprocessar sem-fala pra sempre
        content_score: analysis.content_score,
        analysis,
      }).eq("id", t.id);
      return { titulo, ok: true, sem_fala: semFala || undefined, content_score: analysis.content_score, viral: a.viral_score?.total, hook: a.hook?.type };
    } catch (e) {
      return { titulo, ok: false, motivo: String(e).slice(0, 100) };
    } finally {
      if (fileName) fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${GEMINI_KEY}`, { method: "DELETE" }).catch(() => {});
    }
  }));

  // indexação pgvector dos recém-analisados corre em paralelo com o recálculo do score
  const emb = fetch(new URL(`/api/video-embeddings?handle=${encodeURIComponent(c.handle)}`, req.url), { headers: internalHeaders(), cache: "no-store" }).catch(() => {});
  await fetch(new URL(`/api/score?handle=${encodeURIComponent(c.handle)}`, req.url), { method: "POST", headers: internalHeaders() }).catch(() => {});
  await emb;
  return NextResponse.json({ creator: c.handle, engine: MODEL, alvos: targets.length, resultados: results });
}
