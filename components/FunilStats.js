import Link from "next/link";

/**
 * A faixa de números do funil — universo monitorado, recorte atual, com Análise Profunda,
 * descobertas de hoje. Nasceu na página /descobertas e passou a viver também por cima da
 * pesquisa de /creators (pedido de 03/09/2026): um bloco só, para os dois sítios mostrarem
 * os mesmos números com os mesmos rótulos. As contagens vêm de lib/funil.js; `filtrados` é
 * o único número que muda com a pesquisa, e quem o conhece é a página (ou a barra, no
 * cliente) — por isso entra por prop em vez de ser contado aqui.
 *
 * Sem hooks nem estado: serve num server component e dentro de um client component.
 * `linkDescobertas` desliga o link em quem não é admin — /descobertas é área de Gestão e
 * mandá-lo para lá seria mandá-lo para um redirect.
 */
// Exato até 9.999 (a base de creators anda nos 2 mil e "2k" esconderia o que interessa);
// a partir daí em milhares, como o universo de 51k sempre se mostrou.
const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export default function FunilStats({ universo, filtrados, comAnalise, deHoje, linkDescobertas = true, style }) {
  const hoje = (
    <>
      <div className="n" style={{ color: "var(--gold-bright)" }}>{fmt(deHoje ?? 0)}</div>
      <div className="l">Descobertas hoje{linkDescobertas ? " →" : ""}</div>
    </>
  );
  return (
    <section className="stats" style={{ marginTop: 18, marginBottom: 0, ...style }}>
      <div className="stat"><div className="n">{fmt(universo)}</div><div className="l">Universo monitorado</div></div>
      <div className="stat"><div className="n">{fmt(filtrados)}</div><div className="l">No filtro atual</div></div>
      <div className="stat"><div className="n">{fmt(comAnalise)}</div><div className="l">Com Análise Profunda</div></div>
      {/* clicável de propósito: é a resposta a "onde vejo o que a corrida acabou de trazer" */}
      {linkDescobertas
        ? <Link href="/descobertas?desde=1" className="stat" style={{ textDecoration: "none" }}>{hoje}</Link>
        : <div className="stat">{hoje}</div>}
    </section>
  );
}
