import Link from "next/link";

/**
 * BRIEFING MATCH — os briefings em que este creator já entrou no casting.
 *
 * A lista respeita a visibilidade de briefings (individuais desde set/2026; o admin vê
 * todos) — a página filtra pelos briefings que o utilizador pode ver antes de chegar aqui.
 *
 * Sem nota nem papel (feedback do cliente, set/2026): fica o briefing, o estado e a
 * evidência que levou a creator a entrar.
 */
const ESTADO = {
  aprovada: ["Aprovada", "var(--green)"],
  aprovado: ["Aprovado", "var(--green)"],
  recusada: ["Recusada", "var(--red)"],
  recusado: ["Recusado", "var(--red)"],
  pendente: ["Pendente", "var(--text-dim)"],
  sugerida: ["Sugerida", "var(--gold)"],
  sugerido: ["Sugerido", "var(--gold)"],
};

export default function BriefingMatch({ matches }) {
  if (!matches?.length) {
    return (
      <div className="panel">
        <h3>Briefing match <span>· castings em que já entrou</span></h3>
        <div className="fc-vazio">Este creator ainda não apareceu em nenhum briefing seu.</div>
      </div>
    );
  }
  return (
    <div className="panel">
      <h3>Briefing match <span>· {matches.length} casting{matches.length > 1 ? "s" : ""}</span></h3>
      {matches.map((m) => {
        const [rot, cor] = ESTADO[m.status] || [m.status || "no casting", "var(--text-dim)"];
        return (
          <div className="fc-brief" key={m.id}>
            <div className="fc-brief-h">
              <Link href={`/campanha/${m.campaign_id}`} className="fc-brief-n">{m.name ?? "briefing"}</Link>
              <span className="fc-brief-s" style={{ color: cor }}>{rot}</span>
            </div>
            {m.rationale && <div className="fc-brief-t">{m.rationale}</div>}
          </div>
        );
      })}
    </div>
  );
}
