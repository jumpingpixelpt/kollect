import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer as supabase } from "@/lib/supabase";
import { radarData, slimRow } from "@/lib/radar-data";
import { sessionRole } from "@/lib/auth-server";
import EvaluateBar from "@/components/EvaluateBar";
import CreatorsInfinite from "@/components/CreatorsInfinite";
import CreatorsHubWorkspace from "@/components/CreatorsHubWorkspace";
import { isTier } from "@/lib/list-filters";

export const revalidate = 30;

// 20 por fatia (22/09/2026), como a lista de Creators do briefing (components/ListaCasting.js):
// o SSR desenha 20 e o resto chega por «Carregar mais 20» / scroll infinito.
const PAGE = 20;

// Parâmetros que a página lê da URL. Os da barra (q, tema, tier, sn, n, l, p, fw, b, sort,
// dir) são estado do cliente espelhado na URL; c/cs (casting de uma campanha) e ft (formato)
// são recortes só por URL. `sn` (sub-nicho) voltou à barra como "Creator's Topic" e `fw`
// (faixas antigas de seguidores) saiu dela para o Tier — continua a valer pelos links.
const PARAMS = ["q", "tema", "tier", "n", "l", "p", "fw", "b", "sort", "dir", "c", "cs", "sn", "ft"];

// As abas "Top Conteúdos do Creator" e "Mood Board" saíram do Hub (feedback rodada 2, F3.3):
// os dois blocos vivem agora na ficha, em rolo. Os links antigos ?aba=top|mood&creator=<id>
// vão para a secção correspondente da ficha.
const ABA_ANCORA = { top: "top", mood: "mood" };

/**
 * Buscar creators — a lista completa da base, com a busca e os filtros numa barra só.
 *
 * SSR só da 1ª fatia + scroll infinito via /api/creators-list — a base inteira nunca viaja
 * no primeiro load. A barra vive no cliente (components/CreatorsInfinite.js): mudar um
 * filtro refaz o pedido sem navegar, e a URL acompanha, para o recorte ser partilhável e
 * sobreviver ao refresh — é daqui que os parâmetros saem para a 1ª fatia.
 */
export default async function CreatorsHub(props) {
  const searchParams = await props.searchParams;
  const aba = searchParams?.aba, alvo = searchParams?.creator;
  if (typeof aba === "string" && aba && typeof alvo === "string" && /^[0-9a-f-]{36}$/i.test(alvo)) {
    redirect(`/creator/${alvo.toLowerCase()}${ABA_ANCORA[aba] ? `#${ABA_ANCORA[aba]}` : ""}`);
  }

  const sp = {};
  for (const k of PARAMS) { const v = searchParams?.[k]; if (typeof v === "string" && v) sp[k] = v; }

  const { user, role } = await sessionRole();
  const [{ all, campaigns, brandOpts, subnichoOpts, subnichoTopOpts, tema }, { data: allLists }, { data: allTags }] = await Promise.all([
    // userId: o filtro por briefing é individual (ver soMeus em lib/auth-server.js)
    radarData(sp, { userId: user?.id ?? null, isAdmin: role === "admin" }),
    supabase.from("lists").select("id, name").order("created_at", { ascending: false }),
    supabase.from("tags").select("id, name").order("name"),
  ]);

  // Creator's Topic: os sub-nichos frequentes; um `sn` raro vindo de link entra como opção
  // extra, para o dropdown não fingir que não há filtro
  const topics = [...(subnichoTopOpts ?? [])]; // cópia: a lista vem da base em cache
  if (sp.sn && !topics.some(([k]) => k === sp.sn)) {
    topics.push([sp.sn, (subnichoOpts ?? []).find(([k]) => k === sp.sn)?.[1] ?? sp.sn]);
  }
  if (sp.tier && !isTier(sp.tier)) delete sp.tier;

  return (
    <div className="wrap">
      <section className="busca-head">
        <h1>Creators Hub</h1>
        <p>Encontre um creator pelo nome ou @. Explore os perfis e suas evidências em um só lugar.</p>
      </section>

      {sp.c && (
        <div className="camp-banner">
          <span>✦ Mostrando o casting de <strong>{campaigns.find((cp) => cp.id === sp.c)?.name ?? "campanha"}</strong> — veja os requisitos e as evidências do briefing:</span>
          <Link href={`/campanha/${sp.c}`} className="chip">Abrir página da campanha →</Link>
        </div>
      )}

      {/* sempre montado, mesmo com o recorte vazio: é na barra que se limpa o filtro que o esvaziou */}
      <CreatorsHubWorkspace>
        <CreatorsInfinite initial={all.slice(0, PAGE).map(slimRow)} total={all.length} pageSize={PAGE}
          podeApagar={role === "admin"} filtros={sp} tema0={tema ?? null} brands={brandOpts} topics={topics} lists={allLists ?? []} campaigns={campaigns} tags={allTags ?? []} />
        <details className="panel" style={{ marginTop: 24 }}>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>Avaliar um perfil pelo link</summary>
          <p style={{ color: "var(--text-faint)", margin: "12px 0", fontSize: 12 }}>Tem um perfil específico em mente? Cole o link para consultar ou analisar o creator.</p>
          <EvaluateBar />
        </details>
      </CreatorsHubWorkspace>

      <footer className="footer">
        <span>KOLLECT by Snack</span>
        <span>Atualizado diariamente · Confidencial</span>
      </footer>
    </div>
  );
}
