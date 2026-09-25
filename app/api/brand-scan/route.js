import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getVideosByCreator } from "@/lib/tubular";
import { RX_PUBLI } from "@/lib/publi";
import { ErroProvedor } from "@/lib/erro-publico";
import { respostaErro } from "@/lib/erro-rota";
import { exigirSessao } from "@/lib/api-auth";
import { limitar } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET ?handle=xxx — histórico de marcas do creator:
 * puxa até 50 legendas do último ano via Tubular e o Claude extrai as parcerias
 * (publi declarada #publi/#ad, afiliado, recebido/press kit, menção orgânica).
 *
 * Erros (feedback rodada 2, bug 1): a resposta leva só a mensagem amigável; o texto do
 * provedor vai para os logs e, no `detalhe`, só a quem chama com o Bearer (enrich,
 * atualizar-lote) — é aí que "resposta não-JSON" serve para diagnóstico.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  const travado = await limitar(req, { rota: "brand-scan", max: 30, janelaMs: 60_000 });
  if (travado) return travado;
  try {
    return await scan(req);
  } catch (e) {
    const { error, ...resto } = respostaErro(req, e, "brand-scan");
    return NextResponse.json({ fatal: error, ...resto }, { status: 200 });
  }
}

async function scan(req) {
  const clean = (s) => String(s ?? "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  const { TUBULAR_API_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!TUBULAR_API_KEY || !ANTHROPIC_API_KEY) return NextResponse.json({ error: "faltam chaves" }, { status: 503 });

  const handle = new URL(req.url).searchParams.get("handle");
  const db = supabaseAdmin();
  const { data: c } = await db.from("creators").select("id, handle, platform, tubular_id, name").eq("handle", handle).single();
  if (!c) return NextResponse.json({ error: "creator não encontrado" }, { status: 422 });

  let captions = [];
  if (c.tubular_id && !String(c.tubular_id).startsWith("ic_")) {
    try {
      const vids = await getVideosByCreator(c.tubular_id, { platforms: [c.platform], size: 50, daysBack: 365 });
      captions = vids
        .map((v) => ({ t: (v.title || "").slice(0, 220), tr: "", views: v.views || 0, eng: v.engagements?.total || 0, data: (v.publish_date || "").slice(0, 10), u: v.video_url || null }))
        .filter((v) => v.t.length > 3);
    } catch { /* cota Tubular — cai pro banco */ }
  }
  if (!captions.length) {
    // fallback: legendas já ingeridas no banco (ex.: promoção via Apify)
    const { data: dbVids } = await db.from("videos").select("title, views, likes, comments, posted_at, transcript, url").eq("creator_id", c.id).order("posted_at", { ascending: false }).limit(50);
    captions = (dbVids || [])
      .map((v) => ({ t: (v.title || "").slice(0, 220), tr: (v.transcript || "").slice(0, 400), views: v.views || 0, eng: (v.likes || 0) + (v.comments || 0), data: v.posted_at || "", u: v.url || null }))
      .filter((v) => v.t.length > 3 || v.tr.length > 10);
  }
  if (!captions.length) return NextResponse.json({ error: "sem legendas" }, { status: 422 });

  // ── brand engagement (calculado após o Claude, com regex ∪ índices contextuais) ──
  // A régua do que é publi mora em lib/publi.js — a ficha do creator marca as peças e
  // calcula a saturação comercial com a mesma, e duas cópias divergiriam em silêncio.
  const COMERCIAL = RX_PUBLI;
  function calcBrandEngagement(idxClaude) {
    const isCom = (v, i) => COMERCIAL.test(v.t) || (idxClaude || []).includes(i);
    const comerciais = captions.filter((v, i) => isCom(v, i));
    const organicos = captions.filter((v, i) => !isCom(v, i));
    const comEng = (v) => (v.views > 0 && v.eng > 0 ? v.eng / v.views : null);
    const med = (arr) => { const a = arr.map(comEng).filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const medViews = (arr) => { const a = arr.map((v) => v.views).filter(Boolean).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const mC = med(comerciais), mO = med(organicos);
    const vC = medViews(comerciais), vO = medViews(organicos);
    if (comerciais.length < 2) return null;
    const usaEng = mC != null && mO != null;
    const ratio = usaEng ? mC / mO : vC && vO ? vC / vO : null;
    if (ratio == null) return null;
    const termo = usaEng ? "engaja" : "alcança";
    return {
      metrica: usaEng ? "engajamento" : "alcance (views)",
      videos_comerciais: comerciais.length, videos_organicos: organicos.length,
      eng_comercial_pct: usaEng ? Math.round(mC * 10000) / 100 : null,
      eng_organico_pct: usaEng ? Math.round(mO * 10000) / 100 : null,
      views_mediana_comercial: vC, views_mediana_organica: vO,
      ratio: Math.round(ratio * 100) / 100,
      leitura: ratio >= 1.1
        ? `Publi ${termo} MAIS que o orgânico (+${Math.round((ratio - 1) * 100)}%) — a audiência aceita conteúdo de marca.`
        : ratio >= 0.85
          ? `Publi ${termo} no mesmo nível do orgânico — conteúdo de marca não derruba a performance.`
          : `Publi ${termo} MENOS que o orgânico (−${Math.round((1 - ratio) * 100)}%) — conteúdo de marca dilui a audiência; briefing precisa ser mais nativo.`,
    };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      // 8000 e não 4000: a resposta traz marcas, nichos, sub-nichos e formatos, e num creator com
      // dezenas de parcerias os 4000 cortavam o JSON a meio ("resposta não-JSON" — 4 casos no
      // lote de cabelo de 03/09/2026, sempre os mesmos handles, portanto não era acaso).
      model: "claude-sonnet-4-6", max_tokens: 8000,
      messages: [{ role: "user", content: `IMPORTANTE: responda começando IMEDIATAMENTE com o caractere { — proibido qualquer texto, análise ou raciocínio antes do JSON.

Analise as legendas E as transcrições (FALA) dos vídeos do último ano do creator ${clean(c.name)} e extraia o histórico de parcerias com marcas. A FALA (o que a pessoa realmente DIZ no vídeo) é a evidência mais forte do território/nicho — se a legenda sugerir um tema mas a fala for outra coisa (ex.: trend de música, dança, lifestyle e não beleza), classifique pelo conteúdo REALMENTE falado. Indícios: #publi/#publ1/#ad/#parceriapaga = publi declarada; ID + Mercado Livre = afiliado; "recebidos"/"press kit" = seeding; menção espontânea = orgânica.

Responda APENAS com JSON válido:
{"marcas":[{"marca":"nome normalizado","categoria":"beleza|outra","tipo":"publi|afiliado|seeding|organica","videos":2,"views_total":123456,"ultima":"2026-01-15","evidencia":"trecho curto da legenda","pecas":[números dos vídeos numerados em que a marca aparece]}],"nichos":[{"nicho":"ex: Cabelo","pct":60}],"sub_nichos":["ex: Cabelos cacheados","Coloração"],"formatos":["ex: Tutorial","Review de produto","GRWM"],"resumo":"2 frases sobre o perfil comercial do creator"}

Em "nichos", distribua o conteúdo do creator em até 4 territórios com percentuais somando 100.
CONTEXTO: este é um radar de BEAUTY (creators de beleza). Classifique cada creator DENTRO do universo de beleza — nunca use rótulos genéricos de lifestyle/entretenimento.
Em "nichos", use como território um destes 6 (radar do cliente): Skincare, Maquiagem, Cabelo, Perfumaria, Unhas, Lifestyle (Lifestyle só quando o conteúdo de beleza for minoria real). Distribua em até 4 com percentuais somando 100.
Em "sub_nichos", liste de 1 a 5 sub-nichos do creator PREFERINDO esta taxonomia de beleza (só crie termo novo se nenhum couber):
- Skincare: Skincare pele madura/antissinais; Skincare coreano (K-beauty, glass skin); Skincare pele acneica/oleosa; Skincare pele sensível/rosácea; Skincare minimalista (skinimalism); Skincare masculino; Skincare pele negra/melaninada; Dermocosméticos e ativos (retinol, ácidos, vitamina C, niacinamida); Clean beauty/natural/vegano; Skincare corporal (body care).
- Maquiagem: Maquiagem natural/no makeup; Maquiagem editorial/artística; Maquiagem para noivas; Maquiagem pele madura; Maquiagem pele negra (subtons); Maquiagem coreana/soft glam; Clean girl/latte makeup/tendências; Drugstore/farmácia (acessível); Alto padrão/luxo.
- Cabelo: Cacheado e crespo (método curly, transição); Coloração (loiros, ruivos, fantasia, balayage); Liso/fios finos; Fios danificados/químicas; Queda capilar; Caspa/dermatite seborreica; Cronograma capilar e finalização; Penteados; Cortes e tendências; Tricologia/couro cabeludo; Hair care minimalista; Extensões/megahair/perucas.
- Perfumaria: Nicho/luxo; Nacionais/acessíveis; Resenhas e layering; Árabe/Oriente Médio; Notas e famílias olfativas; Masculinos; Clones/dupes; Por ocasião.
- Unhas: Nail art e tendências (chrome, jelly, aura); Gel/fibra/acrigel; Naturais e cuidado de cutícula; Encapsuladas e 3D; Nailfies minimalistas.
Em "formatos", liste de 1 a 5 formatos PREFERINDO esta lista: GRWM (Get Ready With Me); Vlogs e rotinas (morning/night); Aesthetic/mood; Tutoriais e how-to; Antes e depois/transformação; POV e storytelling; Beauty hauls e unboxings; Resenhas e reviews; Educativo/expert; Sustentabilidade/clean beauty; Listas e rankings; Reações e comentários; Cobertura de evento; Trends e challenges; Comparativos e testes; Behind the scenes; ASMR e sensorial; Q&A e interação; Sazonal/ocasião; Campanhas/publis.
Em "categoria" de cada marca: "beleza" para cosméticos, maquiagem, skincare/dermocosmético, cabelo, unhas, perfumaria e cuidado pessoal de beleza; "outra" para tudo fora disso (marketplace, moda não-beauty, eletrônico, comida/bebida, games, automóvel, hotelaria, banco etc.).

Ordene por relevância (publi > afiliado > seeding > orgânica, e por views). Máximo 12 marcas; evidência com no máximo 80 caracteres.
Inclua também no JSON: "indices_comerciais": [números dos vídeos que são publi/afiliado/seeding — pelo contexto, mesmo sem hashtag].
Legendas numeradas (com views e data):
${captions.map((v, i) => `[${i}] [${v.data} · ${v.views} views] LEGENDA: ${clean(v.t) || "(sem legenda)"}${v.tr ? `\n    FALA: ${clean(v.tr)}` : ""}`).join("\n")}` }],
    }),
  });
  const out = await res.json();
  if (!res.ok) return NextResponse.json(respostaErro(req, new ErroProvedor("anthropic", res.status, out), "brand-scan"), { status: 200 });

  let parsed;
  try {
    const txt = out.content[0].text;
    parsed = JSON.parse((txt.match(/\{[\s\S]*\}/) || [txt])[0]);
  }
  catch { return NextResponse.json(respostaErro(req, new Error(`resposta não-JSON: ${String(out.content?.[0]?.text ?? "").slice(0, 400)}`), "brand-scan"), { status: 200 }); }

  const brand_engagement = calcBrandEngagement(parsed.indices_comerciais);
  // Cada marca leva as peças em que aparece — URL e data de publicação — para a ficha as
  // ligar ao conteúdo (feedback do cliente, set/2026, ponto 16: "cada peça deve ser clicável",
  // "a data exibida deve ser a data de publicação da publi"). `ultima` passa a sair das
  // datas reais das peças quando as há, em vez da estimativa do modelo.
  parsed.marcas = (parsed.marcas || []).map((m) => {
    const pecas = [...new Set((Array.isArray(m.pecas) ? m.pecas : []).map(Number))]
      .map((i) => captions[i]).filter((v) => v && v.u)
      .map((v) => ({ url: v.u, data: v.data || null, views: v.views || 0 }))
      .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    const ultima = pecas.find((x) => x.data)?.data || m.ultima || null;
    return { ...m, pecas, ultima, videos: pecas.length || m.videos };
  });
  // A escrita era `await ... .update(...)` com o resultado deitado fora. Uma gravação
  // recusada — chave sem privilégio, RLS, coluna em falta — passava despercebida e a rota
  // devolvia sucesso: o /api/enrich contava o passo como "ok" e o operador via "10 de 12
  // passos" com a base intacta. Aconteceu ao @principealeff em jul/2026, e custou uma
  // tarde a perceber que o problema não estava em nada do que a resposta dizia.
  const { error: ue } = await db.from("creators")
    .update({ brand_history: { ...parsed, brand_engagement, escaneado_em: new Date().toISOString().slice(0, 10), videos_analisados: captions.length } })
    .eq("id", c.id);
  if (ue) return NextResponse.json(respostaErro(req, new Error(`brand_history não gravado: ${ue.message}`), "brand-scan"), { status: 200 });
  return NextResponse.json({ creator: c.handle, videos_analisados: captions.length, brand_engagement, ...parsed });
}
