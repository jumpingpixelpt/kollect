import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCreatorDetail, contentVideosForClient, profileReading } from "../lib/creator-detail.js";
import { fetchCampaignDetail, campaignCreator } from "../lib/campaign-detail.js";
import { scorecardRede } from "../lib/scorecard.js";
import { saturacaoPubli } from "../lib/publi.js";
import { disasterCheck } from "../lib/disaster.js";
import { tagDaFicha, tagDe, contaNoCasting, roleDe } from "../lib/casting.js";

// Banco em memória com projeção e paginação: os loaders reais têm de pedir os campos
// necessários, completar as páginas e não devolver uma leitura parcial após erro.
// ficha_contas (RPC da ficha): a conta pedida + irmãs com o mesmo person_key, da leaderboard.
const fichaContas = (tabelas) => async (nome, args) => {
  if (nome !== "ficha_contas") return { data: [], error: null };
  const lb = tabelas.leaderboard || [];
  const c = lb.find((r) => r.id === args.p_id);
  const pk = (tabelas.creators || []).find((r) => r.id === args.p_id)?.person_key ?? c?.person_key;
  const rows = [...(c ? [c] : []), ...lb.filter((r) => pk != null && r.person_key === pk && r.id !== args.p_id)];
  return { data: rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), error: null };
};

function banco(tabelas, { falha = () => false, rpc = fichaContas(tabelas) } = {}) {
  const consultas = [];
  return {
    consultas, rpc,
    from(tabela) {
      const q = { tabela, filtros: [], ordem: [], de: 0, ate: Infinity, campos: "*", unica: false };
      const executar = () => {
        consultas.push({ tabela, de: q.de, ate: q.ate });
        if (falha(q)) return { data: null, error: { message: "leitura interrompida" } };
        let rows = [...(tabelas[tabela] || [])].filter((r) => q.filtros.every((f) => f(r)));
        rows.sort((a, b) => {
          for (const [k, asc] of q.ordem) {
            const cmp = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
            if (cmp) return asc ? cmp : -cmp;
          }
          return 0;
        });
        rows = rows.slice(q.de, q.ate + 1).map((r) => {
          if (q.campos === "*") return { ...r };
          return Object.fromEntries(q.campos.split(/,(?![^(]*\))/).map((campo) => {
            campo = campo.trim();
            if (campo.includes("(")) { const k = campo.split("(")[0]; return [k, r[k]]; }
            const [alias, expr] = campo.includes(":") ? campo.split(":") : [campo, campo];
            let valor = expr.split(/->>?/).reduce((v, k) => v?.[k], r);
            if (expr.includes("->>") && valor != null) valor = String(valor);
            return [alias, valor ?? null];
          }));
        });
        return { data: q.unica ? (rows[0] ?? null) : rows, error: null };
      };
      const api = {
        select(campos) { q.campos = campos; return api; },
        eq(k, v) { q.filtros.push((r) => r[k] === v); return api; },
        in(k, vs) { q.filtros.push((r) => vs.includes(r[k])); return api; },
        order(k, { ascending = true } = {}) { q.ordem.push([k, ascending]); return api; },
        range(de, ate) { q.de = de; q.ate = ate; return api; },
        maybeSingle() { q.unica = true; return api; },
        throwOnError() { q.lanca = true; return api; },
        then(ok, erro) {
          return Promise.resolve().then(() => {
            const r = executar();
            if (q.lanca && r.error) throw new Error(r.error.message);
            return r;
          }).then(ok, erro);
        },
      };
      return api;
    },
  };
}

test("grelha recebe publi da fala e métricas completas, sem transcrições nem relatórios", () => {
  const videos = [
    { id: 1, title: "Rotina capilar", transcript: "Parceria #publi na fala", analysis: { veredicto: "relatório reservado ao servidor" }, platform: "tiktok", tipo: "video", url: "https://exemplo.test/1", content_score: 8, views: 1000, likes: 90, comments: 10, shares: 4, saves: 6 },
    { id: 2, title: "Tutorial orgânico", transcript: "sem relação comercial", analysis: {}, platform: "instagram", tipo: "imagem", views: null, likes: 20, comments: 2 },
  ];
  const compactos = contentVideosForClient(videos);
  assert.equal(compactos[0].publi, true);
  assert.equal(compactos[1].publi, false);
  assert.equal(compactos[0].content_score, 8);
  assert.equal(compactos[0].shares + compactos[0].saves, 10);
  assert.equal(compactos[1].views, null);
  assert.equal(compactos[1].tipo, "imagem");
  for (const v of compactos) {
    assert.equal("analysis" in v, false);
    assert.equal("transcript" in v, false);
  }
  assert.equal(saturacaoPubli(videos).publis, compactos.filter((v) => v.publi).length);
  // A limpeza do transporte não modifica a fonte usada pelo scorecard/Disaster Check.
  assert.equal(videos[0].transcript, "Parceria #publi na fala");
});

test("leitura da ficha preserva elegibilidade, presença do ramo e evidências comerciais", () => {
  assert.equal(tagDaFicha(profileReading({ kol_geral: null })), null);
  assert.equal(tagDaFicha(profileReading({ kol_geral: { elegivel: false, classe: "kol" } })), "pool");
  const r = profileReading({
    kol_geral: { elegivel: true, classe: "kol", kol_nao_avaliavel: true },
    niche_bucket: "cabelo", nichos: [{ nicho: "Cabelo", pct: 80 }],
    marcas: [{ marca: "Dove", tipo: "publi", evidencia: "Peça verificada", pecas: [{ url: "https://exemplo.test/p", data: "2026-09-01" }] }],
    brand_engagement_leitura: "As peças comerciais mantêm engajamento.",
  });
  assert.equal(tagDaFicha(r), "kol");
  assert.equal(r.kol_score.geral.kol_nao_avaliavel, true);
  assert.equal(r.kol_screen.metricas.niche_bucket, "cabelo");
  assert.equal(r.brand_history.marcas[0].evidencia, "Peça verificada");
  assert.equal(r.brand_history.marcas[0].pecas[0].data, "2026-09-01");
  assert.equal(r.brand_history.brand_engagement.leitura, "As peças comerciais mantêm engajamento.");
});

test("ficha lê todo histórico e todas as peças, incluindo irmãs, além de 1000 linhas", async () => {
  const main = { id: "principal", person_key: "pessoa", handle: "principal", name: "Perfil", platform: "instagram", followers: 1000 };
  const irma = { id: "irma", person_key: "pessoa", handle: "irma", platform: "tiktok", followers: 2000 };
  const snapshots = Array.from({ length: 1002 }, (_, i) => ({
    id: i, creator_id: "principal", captured_at: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    followers: 1000 + i, avg_views: 100, eng_rate: i === 1001 ? 0 : 2, saves_per_1k: 4, shares_per_1k: 5,
  }));
  const videos = Array.from({ length: 1002 }, (_, i) => ({
    id: i, creator_id: "principal", posted_at: "2026-09-10", title: "Rotina de beleza", views: 100, likes: 10, comments: 1,
    transcript: i === 1001 ? "#publi e casa de apostas" : null,
    analysis: i === 1001 ? { veredicto: "Conteúdo sobre aposta esportiva" } : null,
  }));
  videos.push({ id: 2000, creator_id: "irma", posted_at: "2026-09-09", title: "Rotina", transcript: "#publi", analysis: { texto_longo: "não precisa viajar" }, views: 50, likes: 5 });
  const db = banco({ leaderboard: [main, irma], creators: [{ ...main, kol_score: { geral: { classe: "kol", elegivel: true } } }], snapshots, videos });
  const d = await fetchCreatorDetail(db, "principal");
  assert.equal(d.snaps.length, 1002);
  assert.equal(d.snaps.at(-1).followers, 2001);
  assert.equal(d.snaps.at(-1).eng_rate, 0);
  assert.equal(d.snaps.at(-1).shares_per_1k, 5);
  assert.equal(d.videos.length, 1002);
  // B3.2: da análise só vêm veredicto e temas; peça sem análise continua sem ela
  const comA = d.videos.find((v) => v.id === 1001);
  assert.deepEqual(comA.analysis, { veredicto: "Conteúdo sobre aposta esportiva", temas: null });
  assert.equal(d.videos.find((v) => v.id === 0).analysis, null);
  assert.equal(db.consultas.filter((q) => q.tabela === "leaderboard").length, 0);
  assert.equal(d.vidsIrmas.length, 1);
  // das irmãs só vêm os temas da análise (nuvem da ficha, F3.4); sem temas, nada
  assert.equal(d.vidsIrmas[0].analysis, null);
  assert.equal(d.vidsIrmas[0].transcript, "#publi");
  assert.deepEqual(d.contas.map((c) => c.id), ["irma", "principal"]);
  const card = scorecardRede(d.videos, { hoje: new Date("2026-09-14") });
  assert.equal(card.posts, 1002);
  assert.equal(card.views, 100200);
  assert.equal(saturacaoPubli([...d.videos, ...d.vidsIrmas]).publis, 2);
  assert.equal(disasterCheck({ videos: d.videos }).categorias.find((c) => c.id === "bets").estado, "sinal");
  assert.ok(db.consultas.some((q) => q.tabela === "snapshots" && q.de === 1000));
  assert.ok(db.consultas.some((q) => q.tabela === "videos" && q.de === 1000));
});

test("erro na segunda página não apresenta histórico parcial como completo", async () => {
  const db = banco({
    leaderboard: [{ id: "perfil" }], creators: [{ id: "perfil" }],
    snapshots: Array.from({ length: 1001 }, (_, i) => ({ id: i, creator_id: "perfil", captured_at: "2026-09-01" })),
  }, { falha: (q) => q.tabela === "snapshots" && q.de === 1000 });
  await assert.rejects(fetchCreatorDetail(db, "perfil"), /Não foi possível carregar/);
});

test("casting compacto preserva ramo ausente, ramo sem classe, masculino e inclusão manual", () => {
  const legado = campaignCreator({ screen_classe: "kol", kol_score: { geral: null } });
  const semClasse = campaignCreator({ screen_classe: "kol", kol_score: { geral: {} } });
  assert.equal(tagDe({ kind: "rising" }, legado), "kol");
  assert.equal(tagDe({ kind: "rising" }, semClasse), "pool");
  const c = campaignCreator({
    kol_score: { geral: { classe: "kol" }, masculino: { classe: "rising_star" } },
    screen_disaster: { nivel: "alto", sinais: ["Discurso de ódio"] },
    mulheres_pct: 0, conversa_volume: { media_comentarios: 0, indice_faixa: 0 }, pct_duvidas: 0,
  });
  assert.equal(tagDe({}, c, "masculino"), "rising_star");
  assert.equal(roleDe({}, c, "masculino"), "rising_bet");
  assert.equal(contaNoCasting({ kind: "rising" }, c), false);
  assert.equal(contaNoCasting({ kind: "manual", campaign_role: "not_recommended" }, c), true);
  assert.equal(c.audience.mulheres_pct, 0);
  assert.equal(c.conversa.volume.media_comentarios, 0);
  assert.equal(c.conversa.conteudo.pct_duvidas, 0);
});

test("casting carrega mais de 1000 creators e usa observação não-nula, mantendo zero", async () => {
  const creators = Array.from({ length: 1002 }, (_, i) => ({ id: `c${i}`, name: `Perfil ${i}`, kol_score: { geral: { classe: "kol" } } }));
  let pedidosMetricas = 0;
  const db = banco({ creators }, { rpc: async (nome, { p_creator_ids: ids }) => {
    assert.equal(ids.length, 1002);
    if (nome === "campaign_creator_classes") return { error: null, data: ids.map((id) => ({ id, kol_score: { geral: { classe: "kol" } } })) };
    pedidosMetricas++;
    return { error: null, data: ids.map((id) => ({ creator_id: id, eng_rate: null, avg_views: null, last_eng_rate: id === "c1001" ? 0 : 3, last_avg_views: 100 })) };
  } });
  const d = await fetchCampaignDetail(db, creators.map((c) => ({ creator_id: c.id })));
  assert.equal(d.creators.length, 1002);
  assert.equal(d.creators.find((c) => c.id === "c1001").kol_score.geral.classe, "kol");
  assert.equal(d.snapBy.c1001.eng_rate, 0);
  assert.equal(d.snapBy.c0.eng_rate, 3);
  assert.equal(d.snapBy.c0.avg_views, 100);
  assert.equal(pedidosMetricas, 1);
});

test("classes incompletas não fazem o casting herdar silenciosamente a régua antiga", async () => {
  const db = banco({ creators: [{ id: "perfil", kol_screen: { classe: "kol" } }] });
  await assert.rejects(fetchCampaignDetail(db, [{ creator_id: "perfil" }]), /todas as classes/);
});
