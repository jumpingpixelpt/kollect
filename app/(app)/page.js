import { supabaseServer as supabase } from "@/lib/supabase";
import { sessionRole, soMeus } from "@/lib/auth-server";
import { fetchPageCounts } from "@/lib/page-data";
import { buscasPendentes, aberturas } from "@/lib/buscas";
import BuscaTabs from "@/components/BuscaTabs";
import UltimosBriefings from "@/components/UltimosBriefings";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * Busca — a entrada da plataforma.
 *
 * Era o cockpit do radar: contagens do universo, oportunidades, portfólio de marcas,
 * sinais e atividade (fica comentado no fim deste ficheiro). Cinco dobras de leitura
 * antes de se poder pedir o que quer que fosse — e o pedido, quando chegava, era uma
 * caixa de texto solta que o modelo interpretava sem mostrar a interpretação.
 *
 * Agora a página é o pedido: o briefing com as partes que o match precisa e a lista do que já se
 * pediu. O painel de números não desapareceu por ser inútil — desapareceu por não ser
 * o primeiro gesto de quem chega.
 * Desde 16/09/2026, a pesquisa e validação de um creator ficam no Creators Hub.
 */
export default async function Busca() {
  const { user, role } = await sessionRole();
  const { data: camps, error } = await soMeus(supabase.from("campaigns").select("id, name, created_at"), user?.id, role === "admin")
    .order("created_at", { ascending: false }).order("id").limit(60);
  if (error) throw new Error("Não foi possível carregar os briefings");
  // Só contar as campanhas visíveis nesta página. O Postgres devolve os totais,
  // não milhares de membros de todas as campanhas para somar no servidor.
  // Histórico no servidor (feedback rodada 2, bug 2): as aberturas de quem está a ver
  // ("Recentemente aberto por você", antes em localStorage) e as buscas dele que não
  // chegaram a briefing ("Não concluída" → Retomar). Ambas falham para vazio.
  const ids = (camps ?? []).map((c) => c.id);
  const [{ campaigns: counts }, abertos, pendentes] = await Promise.all([
    fetchPageCounts(supabase, { campaignIds: ids }),
    aberturas(user?.id, ids),
    buscasPendentes(user?.id),
  ]);
  const campCount = Object.fromEntries(counts.map((c) => [c.id, c]));

  // Os dois briefings fixos do cliente tinham porta própria por baixo do formulário
  // ("Ou abre um briefing do cliente"), removida a pedido: são campanhas como as outras
  // e chegam-se pela lista aqui em baixo, onde a ordenação por aberto-por-você os põe
  // à cabeça de quem os trabalha.
  const briefings = (camps ?? []).map((cp) => ({ id: cp.id, name: cp.name, created_at: cp.created_at, aberto_em: abertos[cp.id] || null, ...(campCount[cp.id] || { total: 0, kol: 0, rising: 0 }) }));

  return (
    <>
      {/* Fora do .wrap de propósito: lá dentro os apontamentos ficavam presos ao respiro
          lateral e à centragem do max-width, e sobrava um vazio entre eles e os cantos.
          Como irmão do .wrap, o bloco de contenção é o .mainpane — o painel inteiro. */}
      <div className="match-orbits" aria-hidden="true" />
      <div className="wrap match-page">
        <section className="cmd-hero cmd-hero-busca">
          <div className="match-spark" aria-hidden="true">✦</div>
          <h1>Creators <em>Match</em></h1>
          <p>Ideas meet people</p>
        </section>

        <BuscaTabs />

        <section className="cmd-sec">
          <div className="cmd-h"><span>✦</span>Histórico de briefings</div>
          <UltimosBriefings items={briefings} pendentes={pendentes} />
        </section>

        <footer className="footer">
          <span>KOLLECT by Snack</span>
          <span>Atualizado diariamente · Confidencial</span>
        </footer>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA ANTIGA — o cockpit do radar, comentado em 01/set/2026 quando a Busca
// passou a ser o formulário de pedido. Fica aqui inteiro, e não apagado, porque
// as suas dobras (Beauty Intelligence Overview, Top Opportunities, Brand
// Portfolio Intelligence, Signals, Recent Activity) são leituras que o cliente
// vai querer noutro sítio — provavelmente numa página própria de panorama.
// Comentado linha a linha de propósito: tem um bloco /** */ que partiria um
// comentário envolvente.
// ─────────────────────────────────────────────────────────────────────────────
// import Link from "next/link";
// import CampaignDelete from "@/components/CampaignDelete";
// import { supabaseServer as supabase, supabaseAdmin } from "@/lib/supabase";
// import FlowChooser from "@/components/FlowChooser";
// import { radarData, fetchAllRows } from "@/lib/radar-data";
// import { sessionRole } from "@/lib/auth-server";
//
// export const revalidate = 30;
//
// /**
//  * Cockpit do radar — contagens, oportunidades e sinais.
//  * A LISTA de creators mudou-se para /creators (SSR da 1ª fatia + scroll infinito):
//  * carregar a base inteira aqui atrasava a entrada na plataforma. Por isso o
//  * radarData corre em modo light — sem snapshots nem vídeos, as duas tabelas mais
//  * pesadas, que só a lista/dossiê precisam.
//  */
// export default async function Home() {
//   // o atalho para Descobertas é de admin (o funil de captação é operação da casa)
//   const { role } = await sessionRole();
//   const isAdmin = role === "admin";
//   const [{ allUnfiltered: all, campaigns, bhRows, topNicho }, campCreators, allFits, fixosRows] = await Promise.all([
//     radarData({}, { light: true }),
//     supabase.from("campaign_creators").select("campaign_id, kind").then((r) => r.data || []),
//     fetchAllRows(() => supabase.from("brand_fit").select("creator_id, fit_score, brands(name, client)")),
//     supabase.from("campaigns").select("id, name, parsed").not("parsed->>fixo", "is", null)
//       .order("created_at", { ascending: false }).then((r) => r.data || []),
//   ]);
//   // universo = o que é acionável: irrecuperáveis (sem @, logo não promovíveis) ficam de fora,
//   // como nas Descobertas e no badge da sidebar — ver docs/handles-irrecuperaveis.md
//   const { count: universoCount } = await supabaseAdmin().from("prospects").select("*", { count: "exact", head: true })
//     .not("status", "like", "sem_handle:irrecuperavel%");
//
//   const baseTotal = all.length;
//   const kolCount = all.filter((c) => c.is_kol).length;
//   const risingStarCount = all.filter((c) => c.is_rising_star).length;
//   const hiddenGemCount = all.filter((c) => c.classe === "hidden_gem").length;
//   const brandPerfCount = all.filter((c) => c.classe === "brand_safe_performer").length;
//
//   // matches por campanha (Active Briefings)
//   const campCount = {}; for (const r of campCreators ?? []) { const a = (campCount[r.campaign_id] ||= { total: 0, kol: 0, rising: 0 }); a.total++; if (r.kind === "kol") a.kol++; if (r.kind === "rising") a.rising++; }
//
//   // Briefings fixos do cliente (§4 do briefing: um geral feminino + um masculino). Existiam
//   // só como linha em `campaigns`, alcançáveis por /api/campaign?fixo= — sem porta na UI
//   // caíam no meio das Active Briefings, ordenadas por data, e acabavam recriados à mão.
//   // Um por eixo (o mais recente), feminino primeiro por ser o briefing geral.
//   const fixoBy = {}; for (const c of fixosRows) { const k = c.parsed?.fixo; if (k && !fixoBy[k]) fixoBy[k] = c; }
//   const briefingsFixos = Object.values(fixoBy)
//     .map((c) => ({ id: c.id, name: c.name, publico_alvo: c.parsed?.publico_alvo ?? null, total: campCount[c.id]?.total ?? 0 }))
//     .sort((a, b) => (a.publico_alvo === "masculino" ? 1 : 0) - (b.publico_alvo === "masculino" ? 1 : 0));
//
//   // Top Opportunities: melhores por classe, com headline do exec_brief.
//   // O exec_brief é a coluna JSON mais pesada da base (4,2 MB no total) e só estas
//   // seis linhas o usam — por isso saiu da montagem partilhada em lib/radar-data.js
//   // e é buscado aqui só para os ids que a dobra mostra.
//   // "Melhores" por que régua: a do briefing (kol_nota da view), não a do screening. Ordenava
//   // por kol_index, e desde que o card e a ficha passaram a mostrar o Score KOL, escolher os
//   // destaques por outro número punha aqui nomes que a lista não põe à cabeça.
//   const oppPick = (cl, n) => all.filter((c) => c.classe === cl).sort((a, b) => (Number(b.kol_nota) || 0) - (Number(a.kol_nota) || 0)).slice(0, n);
//   const oppRaw = [...oppPick("kol", 2), ...oppPick("rising_star", 2), ...oppPick("hidden_gem", 2)];
//   const { data: oppBriefs } = await supabase.from("creators").select("id, exec_brief").in("id", oppRaw.map((c) => c.id));
//   const ebBy = {};
//   for (const r of oppBriefs ?? []) if (r.exec_brief?.headline) ebBy[r.id] = { headline: r.exec_brief.headline, role: r.exec_brief.recommended_role };
//   const topOpps = oppRaw.map((c) => ({ ...c, eb: ebBy[c.id] }));
//   const OPP = { kol: ["👑", "KOL"], rising_star: ["★", "Rising Star"], hidden_gem: ["💎", "Hidden Gem"], brand_safe_performer: ["🛡", "Brand Safe"] };
//   const thumbU = (u) => (u ? (/cdninstagram|fbcdn|tiktokcdn|cloudfront/.test(u) ? `/api/thumb?u=${encodeURIComponent(u)}&v=3` : u) : null);
//
//   // ───── Dobra 5: Brand Portfolio Intelligence ─────
//   // classe do §8 (kol_classe, escalar que a montagem partilhada já traz), não a do screening
//   // — senão o portfólio contava creators que a lista já não rotula assim
//   const classeBy = {}; for (const r of bhRows ?? []) if (r.kol_classe) classeBy[r.id] = r.kol_classe;
//   const BRANDS_ORDER = ["Elsève", "L'Oréal Paris", "Garnier", "Maybelline", "Kérastase"];
//   const portfolio = {};
//   for (const f of allFits ?? []) {
//     if ((f.brands?.client || "loreal") !== "loreal" || !f.brands?.name || Number(f.fit_score) < 50) continue;
//     const pf = (portfolio[f.brands.name] ||= { kol: 0, rising: 0, gem: 0, brand: 0, terr: {} });
//     const cl = classeBy[f.creator_id];
//     if (cl === "kol") pf.kol++; else if (cl === "rising_star") pf.rising++; else if (cl === "hidden_gem") pf.gem++; else if (cl === "brand_safe_performer") pf.brand++;
//     const t = topNicho[f.creator_id]?.nicho; if (t) { const k = String(t).split(/[&/|]/)[0].trim(); pf.terr[k] = (pf.terr[k] || 0) + 1; }
//   }
//   const brandCards = BRANDS_ORDER.filter((b) => portfolio[b] && (portfolio[b].kol + portfolio[b].rising + portfolio[b].gem + portfolio[b].brand) > 0)
//     .map((b) => ({ name: b, ...portfolio[b], terrs: Object.entries(portfolio[b].terr).sort((a, c) => c[1] - a[1]).slice(0, 3).map((x) => x[0]) }));
//
//   // ───── Dobra 6: Signals & Alerts ─────
//   const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
//   const nicheStats = {};
//   // o bucket de nicho continua a ser do screening (é métrica, não classe); a CLASSE é a do §8
//   for (const r of bhRows ?? []) { const b = r.kol_screen?.metricas?.niche_bucket; const cl = r.kol_classe; if (!b || b === "outros") continue; const st = (nicheStats[b] ||= { kol: 0, rising: 0, gem: 0, total: 0 }); st.total++; if (cl === "kol") st.kol++; if (cl === "rising_star") st.rising++; if (cl === "hidden_gem") st.gem++; }
//   const signals = [];
//   for (const [b, st] of Object.entries(nicheStats).sort((a, c) => c[1].total - a[1].total)) {
//     if (st.rising >= 4 && st.kol <= 2) signals.push(`${cap(b)}: poucos KOLs fortes (${st.kol}), mas ${st.rising} Rising Stars em aceleração — território aberto pra construir autoridade.`);
//     else if (st.gem >= 2) signals.push(`${cap(b)}: ${st.gem} Hidden Gems entregando acima do peso — oportunidade de alcance com CPE baixo.`);
//     else if (st.kol >= 3) signals.push(`${cap(b)}: ${st.kol} KOLs validados — território maduro, casting de autoridade disponível.`);
//   }
//   const topSignals = signals.slice(0, 12); // o painel tem scroll próprio — não é preciso cortar em 5
//
//   // ───── Dobra 7: Recent Activity (derivado) ─────
//   const novos7 = all.filter((c) => c.discovered_at && (Date.now() - new Date(c.discovered_at).getTime()) < 7 * 864e5).length;
//   const activity = [
//     ...(campaigns ?? []).slice(0, 6).map((cp) => `Briefing processado em casting: ${cp.name}.`),
//     (novos7 && novos7 < all.length * 0.8) ? `${novos7} creators novos no radar nos últimos 7 dias.` : null,
//     `${kolCount} KOLs e ${risingStarCount} Rising Stars classificados no território beauty.`,
//   ].filter(Boolean);
//
//   return (
//     <div className="wrap">
//       <section className="cmd-hero">
//         <div className="cmd-tag">✦ Creator Intelligence Platform</div>
//         <h1>Qual briefing vamos transformar em <em>casting</em> hoje?</h1>
//         <p>Cole o briefing, o produto ou o território. A plataforma começa pela necessidade da marca — não pela lista de creators.</p>
//         <FlowChooser fixos={briefingsFixos} />
//         <div className="cmd-shortcuts">
//           <Link href="/creators?l=kol" className="cmd-sc"><span className="cmd-sc-ic">👑</span><span className="cmd-sc-t">KOL Match</span><span className="cmd-sc-d">Autoridades reais por território</span></Link>
//           <Link href="/creators?l=rising_star" className="cmd-sc"><span className="cmd-sc-ic">★</span><span className="cmd-sc-t">Rising Radar</span><span className="cmd-sc-d">Quem cresce antes do cachê estourar</span></Link>
//           <Link href="/campanha" className="cmd-sc"><span className="cmd-sc-ic">◧</span><span className="cmd-sc-t">Squad Builder</span><span className="cmd-sc-d">Arquitetura de casting completa</span></Link>
//           <Link href="/creators?l=hidden_gem" className="cmd-sc"><span className="cmd-sc-ic">💎</span><span className="cmd-sc-t">Hidden Gems</span><span className="cmd-sc-d">Pequenas que entregam acima do peso</span></Link>
//         </div>
//       </section>
//
//       <section className="cmd-sec">
//         <div className="cmd-h"><span>◆</span>Beauty Intelligence Overview</div>
//         <div className="stats stats-6">
//           <div className="stat"><div className="n">{(universoCount || 0).toLocaleString("pt-BR")}</div><div className="l">Universo mapeado</div></div>
//           <div className="stat"><div className="n">{baseTotal.toLocaleString("pt-BR")}</div><div className="l">No radar · analisados</div></div>
//           <div className="stat"><div className="n">{kolCount}</div><div className="l">KOLs · autoridade</div></div>
//           <div className="stat"><div className="n">{risingStarCount}</div><div className="l">Rising Stars · aceleração</div></div>
//           <div className="stat"><div className="n">{hiddenGemCount}</div><div className="l">Hidden Gems · oportunidade</div></div>
//           <div className="stat"><div className="n">{brandPerfCount}</div><div className="l">Brand Safe · escala</div></div>
//         </div>
//         <p className="cmd-micro"><b>{(universoCount || 0).toLocaleString("pt-BR")}</b> creators beauty BR descobertos via varredura contínua; <b>{baseTotal.toLocaleString("pt-BR")}</b> promovidos ao radar e analisados em profundidade — classificados por nicho, performance relativa aos pares, consistência, audiência e fit de marca.</p>
//       </section>
//
//       {(campaigns ?? []).length > 0 && (
//         <section className="cmd-sec">
//           <div className="cmd-h"><span>✦</span>Active Briefings</div>
//           <div className="brief-grid">
//             {(campaigns ?? []).slice(0, 6).map((cp) => {
//               const cc = campCount[cp.id] || { total: 0, kol: 0, rising: 0 };
//               return (
//                 <div key={cp.id} className="brief-card-wrap" style={{ position: "relative" }}>
//                   <Link href={`/campanha/${cp.id}`} className="brief-card">
//                     <div className="brief-name" style={{ paddingRight: 30 }}>{cp.name}</div>
//                     <div className="brief-stats">{cc.total} no match · {cc.kol} KOLs · {cc.rising} Rising</div>
//                     <div className="brief-cta">Abrir casting →</div>
//                   </Link>
//                   <CampaignDelete campaignId={cp.id} name={cp.name} />
//                 </div>
//               );
//             })}
//           </div>
//         </section>
//       )}
//
//       {topOpps.length > 0 && (
//         <section className="cmd-sec">
//           <div className="cmd-h"><span>◈</span>Top Opportunities <span className="cmd-h-sub">· por que estão no radar</span></div>
//           <div className="opp-grid">
//             {topOpps.map((c) => {
//               const lbl = OPP[c.classe] || ["·", "Creator"];
//               const terr = c.top_nicho?.nicho ? String(c.top_nicho.nicho).split(/[&/|]/)[0].trim() : c.niche;
//               return (
//                 <Link key={c.id} href={`/creator/${c.id}`} className="opp-card">
//                   <div className="opp-head">
//                     {c.avatar_url ? <img src={thumbU(c.avatar_url)} alt="" loading="lazy" /> : <span className="opp-av">★</span>}
//                     <span className="opp-meta"><span className="opp-name">{c.name}</span><span className="opp-cls">{lbl[0]} {lbl[1]}{terr ? ` · ${terr}` : ""}</span></span>
//                   </div>
//                   <div className="opp-why">{c.eb?.headline || `${lbl[1]} no território ${terr || "beleza"} — performance acima dos pares.`}</div>
//                   <div className="brief-cta">Abrir dossiê →</div>
//                 </Link>
//               );
//             })}
//           </div>
//         </section>
//       )}
//
//       {brandCards.length > 0 && (
//         <section className="cmd-sec">
//           <div className="cmd-h"><span>◱</span>Brand Portfolio Intelligence <span className="cmd-h-sub">· creator × portfólio L'Oréal</span></div>
//           <div className="brief-grid">
//             {brandCards.map((b) => (
//               <div key={b.name} className="bp-card">
//                 <div className="bp-name">{b.name}</div>
//                 {b.terrs.length > 0 && <div className="bp-terr">Territórios fortes: {b.terrs.join(" · ")}</div>}
//                 <div className="bp-counts">
//                   {b.kol > 0 && <span>👑 {b.kol} KOL</span>}
//                   {b.rising > 0 && <span>★ {b.rising} Rising</span>}
//                   {b.gem > 0 && <span>💎 {b.gem} Gems</span>}
//                   {b.brand > 0 && <span>🛡 {b.brand} Safe</span>}
//                 </div>
//               </div>
//             ))}
//           </div>
//         </section>
//       )}
//
//       {(topSignals.length > 0 || activity.length > 0) && (
//         <div className="pane-pair">
//           {topSignals.length > 0 && (
//             <section className="pane">
//               <div className="cmd-h"><span>◉</span>Signals worth watching <span className="cmd-h-sub">· radar vivo</span></div>
//               <div className="pane-body">
//                 <div className="sig-list">
//                   {topSignals.map((sg, i) => <div key={i} className="sig-item">{sg}</div>)}
//                 </div>
//               </div>
//             </section>
//           )}
//
//           {activity.length > 0 && (
//             <section className="pane">
//               <div className="cmd-h"><span>↻</span>Recent Activity</div>
//               <div className="pane-body">
//                 <div className="sig-list">
//                   {activity.map((a, i) => <div key={i} className="act-item">{a}</div>)}
//                 </div>
//               </div>
//             </section>
//           )}
//         </div>
//       )}
//
//       <section className="cmd-sec">
//         <div className="cmd-h"><span>⌖</span>Explorar o radar</div>
//         <div className="cmd-shortcuts">
//           <Link href="/creators" className="cmd-sc"><span className="cmd-sc-ic">⌖</span><span className="cmd-sc-t">Todos os creators</span><span className="cmd-sc-d">{baseTotal.toLocaleString("pt-BR")} no radar · filtros e busca</span></Link>
//           <Link href="/creators?l=janela" className="cmd-sc"><span className="cmd-sc-ic">◈</span><span className="cmd-sc-t">Janela de cachê</span><span className="cmd-sc-d">Contratar antes do cachê escalar</span></Link>
//           <Link href="/creators?l=brand_safe_performer" className="cmd-sc"><span className="cmd-sc-ic">🛡</span><span className="cmd-sc-t">Brand Safe</span><span className="cmd-sc-d">Entrega previsível para escala</span></Link>
//           {isAdmin && <Link href="/descobertas" className="cmd-sc"><span className="cmd-sc-ic">◎</span><span className="cmd-sc-t">Descobertas</span><span className="cmd-sc-d">Funil de prospects a analisar</span></Link>}
//         </div>
//       </section>
//
//       <footer className="footer">
//         <span>KOLLECT by Snack</span>
//         <span>Atualizado diariamente · Confidencial</span>
//       </footer>
//     </div>
//   );
// }
