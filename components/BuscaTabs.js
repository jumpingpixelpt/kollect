import Link from "next/link";
import BriefingForm from "./BriefingForm";

// Busca gera o briefing; a pesquisa e avaliação de nomes ficam no Creators Hub.
export default function BuscaTabs() {
  return (
    <div className="bf-wrap">
      <BriefingForm />
      <p style={{ marginTop: 16, color: "var(--text-faint)", fontSize: 12, textAlign: "center" }}>
        Já tem um nome em mente? <Link href="/creators-hub" style={{ color: "var(--gold-bright)", fontWeight: 500 }}>Pesquisar no Creators Hub →</Link>
      </p>
    </div>
  );
}
