import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer as supabase } from "@/lib/supabase";
import ListCreate from "@/components/ListCreate";
import SquadDetail from "@/components/SquadDetail";
import SquadExternal from "@/components/SquadExternal";
import BigNumbers from "@/components/BigNumbers";
import { fetchPageRows, fetchPageCounts } from "@/lib/page-data";
import { fetchSquadSnapshot } from "@/lib/squad-data";
import "@/components/squad.css";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function Listas(props) {
  const searchParams = await props.searchParams;
  const id = searchParams?.id || null;
  if (id) {
    const snapshot = await fetchSquadSnapshot(supabase, id);
    if (!snapshot?.list) notFound();
    return <div className="wrap squad-page">
      <SquadDetail key={id} initialSnapshot={snapshot} />
      <footer className="footer"><span>KOLLECT by Snack</span><span>Squad · Confidencial</span></footer>
    </div>;
  }
  const lists = await fetchPageRows(() => supabase.from("lists").select("id, name, created_at")
    .order("created_at", { ascending: false }).order("id"));
  const { lists: countRows } = await fetchPageCounts(supabase, { listIds: lists.map((list) => list.id) });
  const counts = Object.fromEntries(countRows.map((row) => [row.id, row]));
  const totalCreators = countRows.reduce((soma, row) => soma + (Number(row.total) || 0), 0);
  // Big numbers antes da explicação (feedback rodada 2, L5).
  return <div className="wrap squad-page">
    <header className="squad-title squad-title-compacto"><span className="squad-eyebrow">TALENTOS EM CONJUNTO</span><h1>Squad</h1></header>
    <BigNumbers compacto className="squad-index-numbers" ariaLabel="Resumo das squads" items={[
      { label: lists.length === 1 ? "Squad" : "Squads", value: lists.length.toLocaleString("pt-BR") },
      { label: "Creators nas squads", value: totalCreators.toLocaleString("pt-BR"), title: "Soma dos membros de todas as squads; o mesmo creator pode estar em mais de uma." },
    ]} />
    <p className="squad-help squad-index-intro">Reúna seus creators, compare o potencial do grupo e acompanhe quem está crescendo.</p>
    <SquadExternal lists={lists} />
    <section className="squad-overview" aria-labelledby="squad-overview-title">
      <div className="squad-section-heading"><div><span className="squad-eyebrow">SEUS GRUPOS</span><h2 id="squad-overview-title">Squads <span className="squad-count">{lists.length}</span></h2></div><ListCreate /></div>
      <div className="squad-overview-list">{lists.map((list) => {
        const count = counts[list.id] || { total: 0, concluida: 0 };
        return <Link href={`/listas?id=${list.id}`} className="squad-overview-card" key={list.id}>
          <div><h3>{list.name}</h3><p>{count.total} {count.total === 1 ? "creator" : "creators"}<br />Criada em {new Date(list.created_at).toLocaleDateString("pt-BR")}</p></div><span aria-hidden="true">→</span>
        </Link>;
      })}</div>
      {!lists.length && <div className="squad-empty"><strong>Monte sua primeira squad.</strong><p>Crie um grupo e adicione creators da base ou perfis externos.</p></div>}
    </section>
    <footer className="footer"><span>KOLLECT by Snack</span><span>Squad · Confidencial</span></footer>
  </div>;
}
