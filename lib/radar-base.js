// Montagem pura da lista: a RPC entrega só os campos usados, mas as regras de
// território, marcas, forecast, conta principal e ordenação continuam em JavaScript.
// Separada da leitura para verificar equivalência sem sessão, rede ou serviços pagos.
import { classify, forecast } from "./forecast.js";
import { isBeautyBrand, canonicalBrandLabel, isExcludedBrand } from "./beauty.js";
import { fold } from "./text.js";
import { territorioDe, TERRITORIO_LABEL } from "./territorio.js";

export function assembleRadarBase({ creators, bhRows, seriesRows, vstats }, { light = false } = {}) {
  // território dominante de cada creator (pro selo KOL carregar o nicho)
  const topNicho = {};
  for (const r of bhRows ?? []) {
    const ns = r.brand_history?.nichos;
    if (ns?.length) topNicho[r.id] = ns.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
  }

  // sub-nicho dominante (1º da lista gerada por IA)
  const topSubnicho = {};
  for (const r of bhRows ?? []) {
    const sn2 = r.brand_history?.sub_nichos?.[0];
    const label = typeof sn2 === "string" ? sn2 : (sn2?.nome || sn2?.sub_nicho);
    if (label) topSubnicho[r.id] = String(label).trim();
  }

  // classe das 5 (kol_screen) + índice
  const klass = {};
  // `kol_index` e a CLASSE do screening saíram daqui: a classe que a app mostra é a do §8
  // (view leaderboard.kol_classe), pela decisão já tomada na página de campanha a 25/07 —
  // o Score KOL vence, inelegível não herda a classe antiga. Do kol_screen resta o
  // niche_bucket, que é métrica de nicho e não classe. Deixar duas classes na linha era
  // guardar uma régua que ninguém lê à espera de ser usada por engano — foi assim que o
  // card e a ficha se desalinharam no score.
  for (const r of bhRows ?? []) if (r.kol_screen?.metricas?.niche_bucket) klass[r.id] = { niche_bucket: r.kol_screen.metricas.niche_bucket };
  // território guardado (creators.territorio) — só existe para quem a derivação não resolve
  const terrGuardado = {}; for (const r of bhRows ?? []) if (r.territorio) terrGuardado[r.id] = r.territorio;
  // quem já tem leitura de nichos da IA: sem beleza lá, o território é Lifestyle
  const analisado = {}; for (const r of bhRows ?? []) if ((r.brand_history?.nichos ?? []).length) analisado[r.id] = true;

  // ── marcas, sub-nichos e formatos (IA, brand_history) → chaves de filtro ──
  const normKey = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
  const brandsByCreator = {}, subnichosByCreator = {}, formatosByCreator = {};
  const brandLabels = {}, subnichoLabels = {}, formatoLabels = {};
  const collect = (items, getLabel, byCreator, labels, id) => {
    const keys = [];
    for (const it of items ?? []) {
      const label = getLabel(it);
      const key = normKey(label);
      if (!key) continue;
      keys.push(key);
      if (!labels[key]) labels[key] = String(label).trim();
    }
    if (keys.length) byCreator[id] = [...new Set(keys)];
  };
  for (const r of bhRows ?? []) {
    const bh = r.brand_history;
    if (!bh) continue;
    const marcasBeauty = (bh.marcas ?? [])
      .map((m) => ({ ...m, _canon: canonicalBrandLabel(m?.marca) }))
      .filter((m) => !isExcludedBrand(m._canon) && isBeautyBrand(m._canon, m?.categoria));
    collect(marcasBeauty, (m) => m._canon, brandsByCreator, brandLabels, r.id);
    collect(bh.sub_nichos, (x) => (typeof x === "string" ? x : x?.nome || x?.sub_nicho), subnichosByCreator, subnichoLabels, r.id);
    collect(bh.formatos, (x) => (typeof x === "string" ? x : x?.nome || x?.formato), formatosByCreator, formatoLabels, r.id);
  }
  // Creator's Topic (barra do Hub, set/2026): os sub-nichos são texto livre da IA — 1.562
  // rótulos distintos a 21/09/2026, a maioria com um creator só. O dropdown mostra apenas os
  // que agrupam pelo menos SUBNICHO_MIN creators; o filtro por URL (`sn`) aceita qualquer um.
  const SUBNICHO_MIN = 10;
  const subnichoN = {};
  for (const id in subnichosByCreator) for (const k of subnichosByCreator[id]) subnichoN[k] = (subnichoN[k] || 0) + 1;
  const toOptions = (labels) => Object.entries(labels).sort((a, b2) => a[1].localeCompare(b2[1], "pt")).map(([k, l]) => [k, l]);

  // séries por creator, já ordenadas por data pela view
  const byCreator = {};
  for (const r of seriesRows || []) byCreator[r.creator_id] = r.snaps || [];
  const lastSnap = {};
  for (const cid in byCreator) lastSnap[cid] = byCreator[cid].at(-1);
  // engajamento: último snapshot que TEM eng_rate (sweeps só de seguidores deixam nulo)
  const lastEng = {};
  for (const cid in byCreator) {
    const withEng = byCreator[cid].filter((s) => s.eng_rate != null);
    if (withEng.length) lastEng[cid] = withEng.at(-1).eng_rate;
  }

  // engajamento e views médios por post (conta primária; vídeos são por conta)
  const engPerPost = {}, viewsPerPost = {};
  for (const v of vstats || []) {
    if (v.eng_per_post != null) engPerPost[v.creator_id] = Number(v.eng_per_post);
    if (v.views_per_post != null) viewsPerPost[v.creator_id] = Number(v.views_per_post);
  }

  const enriched = (creators || []).map((c) => {
    // Território de conteúdo (lib/territorio.js): o bucket do screening quando existe;
    // senão lê-se o que se sabe da creator, para que quem nunca passou pelo screening
    // não fique sem classificação nenhuma.
    const terr = territorioDe({
      guardado: terrGuardado[c.id] ?? null,
      bucket: klass[c.id]?.niche_bucket ?? null,
      textos: [topNicho[c.id]?.nicho, c.niche, c.category],
      analisado: !!analisado[c.id],
    });
    return {
      ...c,
      classification: light ? null : classify(byCreator[c.id] || []),
      fc: light ? null : forecast(byCreator[c.id] || []),
      top_nicho: topNicho[c.id] ?? null,
      // classe do §8, direta da view (kol, rising_star, hidden_gem, brand_safe_performer,
      // elegivel; null = inelegível ou sem cálculo). Os flags derivam dela — eram os do
      // screening e alimentavam contadores e filtros com a régua antiga.
      classe: c.kol_classe ?? null,
      is_kol: c.kol_classe === "kol",
      is_rising_star: c.kol_classe === "rising_star",
      niche_bucket: klass[c.id]?.niche_bucket ?? null,
      territorio: terr,
      brand_keys: brandsByCreator[c.id] ?? [],
      subnicho_keys: subnichosByCreator[c.id] ?? [],
      formato_keys: formatosByCreator[c.id] ?? [],
      eng_rate: lastEng[c.id] ?? lastSnap[c.id]?.eng_rate ?? null,
      avg_views: lastSnap[c.id]?.avg_views ?? null,
      eng_per_post: engPerPost[c.id]
        ?? (() => {
          const er = lastEng[c.id] ?? lastSnap[c.id]?.eng_rate;
          const vp = viewsPerPost[c.id] ?? lastSnap[c.id]?.avg_views;
          return (er != null && vp) ? Math.round((Number(er) / 100) * Number(vp)) : null;
        })(),
      views_per_post: viewsPerPost[c.id] ?? null,
      top_subnicho: topSubnicho[c.id] ?? null,
      // texto normalizado da busca, calculado uma vez por montagem (não por tecla).
      // `_h` fica à parte porque bater no @ vale mais do que bater no nome.
      _s: fold(`${c.name || ""} ${c.handle || ""}`),
      _h: fold(c.handle || ""),
      // `_c` é a categoria em texto — nicho e sub-nicho escritos pela IA, nicho e categoria
      // da ficha, território. É por aqui que "skincare" ou "cabelo cacheado" acham creators
      // sem a palavra estar no nome. À parte do `_s` para pesar menos na relevância.
      _c: fold([topNicho[c.id]?.nicho, topSubnicho[c.id], c.niche, c.category, TERRITORIO_LABEL[terr]].filter(Boolean).join(" ")),
    };
  });

  // agrupa contas da mesma pessoa (person_key): card único, alcance combinado
  const groups = {};
  for (const c of enriched) {
    const key = c.person_key || c.id;
    (groups[key] ||= []).push(c);
  }
  let all = Object.values(groups).map((accs) => {
    const primary = accs.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a));
    return {
      ...primary,
      accounts: accs.map((a) => ({ id: a.id, platform: a.platform, followers: a.followers })),
      followers_combined: accs.reduce((s, a) => s + (a.followers || 0), 0),
      brand_keys: [...new Set(accs.flatMap((a) => a.brand_keys || []))],
      subnicho_keys: [...new Set(accs.flatMap((a) => a.subnicho_keys || []))],
      formato_keys: [...new Set(accs.flatMap((a) => a.formato_keys || []))],
      // o card é um só, mas a pessoa pode ser procurada pelo @ de qualquer rede
      _s: accs.map((a) => a._s).join(" "),
      _c: accs.map((a) => a._c).filter(Boolean).join(" "),
      _hs: accs.map((a) => a._h).filter(Boolean),
    };
  });
  // ORDEM: os elegíveis à cabeça, pela nota do briefing — é essa a pergunta desta página,
  // "quem serve este briefing". Os inelegíveis seguem, ordenados por Radar Score, para não
  // ficarem num bloco sem ordem nenhuma. Ordenava por `kol_index ?? total`, a régua do
  // screening, que deixou de ser a que o card mostra: sem isto os números visíveis apareciam
  // fora de ordem. O deslocamento mantém tudo num só comparador numérico.
  const ordem = (c) => (c.kol_nota != null ? 1e6 + Number(c.kol_nota) : Number(c.total ?? 0));
  all.sort((a, b) => ordem(b) - ordem(a));

  return {
    allUnfiltered: all,
    bhRows: bhRows ?? [],
    topNicho,
    brandOpts: toOptions(brandLabels),
    subnichoOpts: toOptions(subnichoLabels),
    subnichoTopOpts: toOptions(Object.fromEntries(Object.entries(subnichoLabels).filter(([k]) => subnichoN[k] >= SUBNICHO_MIN))),
    formatoOpts: toOptions(formatoLabels),
  };
}
