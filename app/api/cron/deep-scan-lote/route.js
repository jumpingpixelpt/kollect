import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { fetchAllRows } from "@/lib/fetch-all";
import { internalHeaders } from "@/lib/internal-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * DRAIN DO DEEP-SCAN, ao ritmo que o Gemini deixa.
 *
 * Quem entra: creators ELEGÍVEIS no Score KOL (o mesmo corte da cadeia do enrich desde
 * 10/09/2026) com vídeos ainda sem transcrição, por ordem de score. É o que fica por fazer
 * quando a importação em lote corre com ?conteudo=0. UMA passagem por creator (3 vídeos, o
 * padrão do deep-scan): `visitados` guarda a data por handle e o creator só volta a entrar
 * passados 30 dias — é assim que 300 análises/dia chegam a ~100 creators/dia, e não a 25.
 * Quando a fila esvazia a rota DESLIGA-SE (ativo=false): a manutenção mensal é decisão
 * explícita, não um custo que arranca sozinho.
 *
 * O tecto: o File API do Gemini fecha com 429 ao fim de ~300 análises num dia (medido a
 * 04/08/2026; ver a nota em app/api/deep-scan/route.js) e cada tentativa depois disso já
 * pagou o Apify. Por isso: n pequeno por chamada, janela horária no vercel.json DEPOIS do
 * reset diário do Google (meia-noite no Pacífico = 07:00/08:00 UTC), e ao primeiro sinal de
 * quota a rota pausa-se até à janela do dia seguinte. O creator apanhado pela quota NÃO
 * conta como visitado — não foi analisado.
 *
 * Os `visitados` são escritos ANTES de chamar o deep-scan (claim) e depois de cada creator,
 * com releitura da linha: a invocação pode morrer aos 300 s, e o que está só em memória
 * perde-se. Os n creators correm em paralelo para caberem nos 300 s.
 *
 * Estado — sweep_state.deep_scan_lote = { ativo, n, pausado_ate (ISO), visitados: {handle: data},
 * feitos, analises, corridas, ultima }. Lock em sweep_state.deep_scan_lote_lock.
 * Operação: ?ativo=1|0 · ?n= (1–3) · ?despausar=1 gravam e respondem; ?dry=1 mostra a fila;
 * a vaga só corre sem parâmetros (o cron) ou com ?correr=1.
 */
const KEY = "deep_scan_lote";
const LOCK = "deep_scan_lote_lock";
const LOCK_MS = 5 * 60 * 1000;
const RETENTAR_DIAS = 30;
const JANELA_UTC = 8; // hora UTC em que a janela do cron abre (vercel.json) — depois do reset do Google
const VERSAO = "2026-09-11b";
const agora = () => new Date().toISOString();
const hoje = () => agora().slice(0, 10);
const QUOTA = /^gemini\b.*(429|quota|RESOURCE_EXHAUSTED)/i; // só o Gemini: "download 429" é a CDN do vídeo

export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json({ ...SO_ADMIN, versao: VERSAO }, { status: 403 });
  try {
    const sp = new URL(req.url).searchParams;
    const base = new URL(req.url).origin;
    const db = supabaseAdmin();
    const ler = async () => (await db.from("sweep_state").select("value").eq("key", KEY).maybeSingle()).data?.value || {};
    const cfg = { ativo: false, n: 2, visitados: {}, feitos: 0, analises: 0, corridas: 0, ...(await ler()) };
    const guardar = async (patch) => {
      const atual = { ...cfg, ...(await ler()) };
      const p = typeof patch === "function" ? patch(atual) : patch;
      const value = { ...atual, ...p, visitados: { ...(atual.visitados || {}), ...(p.visitados || {}) } };
      // poda: entradas com mais de 30 dias já não filtram nada
      for (const [h, d] of Object.entries(value.visitados)) if (Date.now() - Date.parse(d) > RETENTAR_DIAS * 864e5) delete value.visitados[h];
      Object.assign(cfg, value);
      const { error } = await db.from("sweep_state").upsert({ key: KEY, value, updated_at: agora() }, { onConflict: "key" });
      if (error) throw new Error(`sweep_state: ${error.message}`);
    };
    const resumo = () => ({ ...cfg, visitados: Object.keys(cfg.visitados).length });

    const patch = {};
    if (sp.get("ativo") != null) { patch.ativo = ["1", "true"].includes(sp.get("ativo")); if (patch.ativo) patch.motivo = null; }
    if (sp.get("n") != null && Number.isFinite(Number(sp.get("n")))) patch.n = Math.min(Math.max(Number(sp.get("n")), 1), 3);
    if (sp.get("despausar")) patch.pausado_ate = null;
    if (Object.keys(patch).length) await guardar(patch);

    // fila (também para o dry-run): elegíveis por score, sem quem foi visitado há menos de 30 dias
    const fila = async () => {
      const eleg = (await fetchAllRows(() => db.from("creators").select("id, handle, kol_score").filter("kol_score->geral->>elegivel", "eq", "true").order("id")))
        .map((c) => ({ id: c.id, handle: c.handle, score: Number(c.kol_score?.geral?.score) || 0 }))
        .filter((c) => c.handle && !(cfg.visitados[c.handle] && Date.now() - Date.parse(cfg.visitados[c.handle]) < RETENTAR_DIAS * 864e5))
        .sort((a, b) => b.score - a.score);
      // quem tem peça pendente (mesmo filtro do deep-scan), paginado — um .limit(1000) cortava
      const pendentes = new Set();
      for (let i = 0; i < eleg.length; i += 100) {
        const ids = eleg.slice(i, i + 100).map((c) => c.id);
        const rows = await fetchAllRows(() => db.from("videos").select("creator_id").in("creator_id", ids).is("transcript", null).not("url", "is", null).neq("tipo", "imagem").order("id"));
        for (const v of rows) pendentes.add(v.creator_id);
      }
      return { elegiveis: eleg.length, fila: eleg.filter((c) => pendentes.has(c.id)) };
    };

    if (sp.get("dry")) {
      const f = await fila();
      return NextResponse.json({ versao: VERSAO, dry: true, cfg: resumo(), elegiveis: f.elegiveis, na_fila: f.fila.length, proximos: f.fila.slice(0, cfg.n).map((c) => `${c.handle} (${c.score})`) });
    }
    if (Object.keys(patch).length && !sp.get("correr")) return NextResponse.json({ versao: VERSAO, guardado: true, cfg: resumo() });
    if (!cfg.ativo) return NextResponse.json({ versao: VERSAO, parado: true, cfg: resumo() });
    if (cfg.pausado_ate && Date.now() < Date.parse(cfg.pausado_ate)) return NextResponse.json({ versao: VERSAO, pausado: true, ate: cfg.pausado_ate, motivo: "quota do Gemini esgotada" });

    // ── lock contra chamadas sobrepostas (o claim por creator em `visitados` é a segunda linha) ──
    const { data: lk } = await db.from("sweep_state").select("value").eq("key", LOCK).maybeSingle();
    if (lk?.value?.ate && Date.parse(lk.value.ate) > Date.now()) return NextResponse.json({ versao: VERSAO, ocupado: true, ate: lk.value.ate });
    const lock = (ate) => db.from("sweep_state").upsert({ key: LOCK, value: { ate }, updated_at: agora() }, { onConflict: "key" });
    await lock(new Date(Date.now() + LOCK_MS).toISOString());

    try {
      const f = await fila();
      const lote = f.fila.slice(0, cfg.n);
      if (!lote.length) {
        await guardar({ ativo: false, motivo: "fila vazia", concluido_em: agora() });
        return NextResponse.json({ versao: VERSAO, concluido: true, elegiveis: f.elegiveis, cfg: resumo() });
      }
      // claim + batimento antes de gastar
      await guardar((a) => ({ corridas: (a.corridas || 0) + 1, ultima: { em: agora(), creators: lote.map((c) => c.handle) }, visitados: Object.fromEntries(lote.map((c) => [c.handle, hoje()])) }));

      const out = await Promise.all(lote.map(async (c) => {
        const r = await fetch(`${base}/api/deep-scan?handle=${encodeURIComponent(c.handle)}&cb=${Date.now()}`, { headers: internalHeaders(), cache: "no-store", signal: AbortSignal.timeout(240000) })
          .then((x) => x.json()).catch((e) => ({ error: String(e).slice(0, 80) }));
        const res = Array.isArray(r?.resultados) ? r.resultados : [];
        const motivos = res.filter((x) => !x.ok).map((x) => String(x.motivo || "?"));
        return { handle: c.handle, score: c.score, alvos: r?.alvos ?? 0, ok: res.filter((x) => x.ok).length, falhas: motivos, erro: r?.error || r?.fatal || null, quota: motivos.some((m) => QUOTA.test(m)) || QUOTA.test(String(r?.error || "")) };
      }));
      const quota = out.some((o) => o.quota);
      const analises = out.reduce((s, o) => s + o.ok, 0);
      const pausadoAte = quota ? new Date(Date.parse(hoje() + "T00:00:00Z") + 864e5 + JANELA_UTC * 3600e3).toISOString() : undefined;
      // Quem sai da lista de visitados: apanhou a quota (não foi analisado) ou a rota falhou
      // antes de chegar aos vídeos (`error`/`fatal`: Apify recusado, chaves em falta — a 11/09
      // o actor do TikTok respondia 403 por falta de aprovação na conta). Nenhum dos dois é
      // culpa do creator, e marcá-lo queimava-lhe a janela de 30 dias sem gastar nada.
      const retirar = out.filter((o) => o.quota || o.erro).map((o) => o.handle);
      await guardar((a) => ({ feitos: (a.feitos || 0) + (out.length - retirar.length), analises: (a.analises || 0) + analises, ultima: { em: a.ultima?.em, creators: out.length, analises, quota, retirados: retirar }, ...(pausadoAte ? { pausado_ate: pausadoAte } : {}) }));
      // `visitados` do guardar faz merge, não remove: apaga à parte
      if (retirar.length) {
        const atual = await ler();
        for (const h of retirar) delete atual.visitados?.[h];
        await db.from("sweep_state").upsert({ key: KEY, value: atual, updated_at: agora() }, { onConflict: "key" });
      }
      return NextResponse.json({ versao: VERSAO, processados: out.length, restantes: f.fila.length - out.length, quota_esgotada: quota, pausado_ate: pausadoAte ?? null, resultados: out });
    } finally {
      await lock(new Date(0).toISOString());
    }
  } catch (e) { return NextResponse.json({ versao: VERSAO, fatal: String(e).slice(0, 300) }, { status: 200 }); }
}
