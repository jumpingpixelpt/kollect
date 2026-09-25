"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import FilterSelect from "@/components/FilterSelect";
import BarraBusca from "@/components/BarraBusca";
import styles from "./HistoricoSearch.module.css";

/**
 * Pesquisa e ordenação do Histórico (direcionais, slides 15–16). Mesmo padrão do
 * ProspectSearch: aplica no botão, o estado vai no URL, o link partilhado reproduz o
 * que se está a ver.
 *
 * A pesquisa é pelo TÍTULO do briefing — é o único texto que o cartão mostra e o que
 * quem procura tem na cabeça. Procurar pelo nome de um creator dentro dos castings é
 * outra funcionalidade (varre campaign_creators) e está por decidir com o cliente.
 *
 * "Mais recentes" é o rótulo do mockup e continua a ser o padrão, por data de CRIAÇÃO
 * do briefing. A data da última abertura vive no navegador de cada um e não é ordenável
 * no servidor.
 */
const ORDENS = [
  [null, "Mais recentes"],
  ["antigos", "Mais antigos"],
  ["casting", "Maior casting"],
  ["nome", "Nome (A–Z)"],
];

export default function HistoricoSearch({ q = "", ord = "", de = "", ate = "" }) {
  const router = useRouter();
  const id = useId();
  const finalDate = useRef(null);
  const [vq, setVq] = useState(q);
  const [vord, setVord] = useState(ord || "");
  const [vde, setVde] = useState(de);
  const [vate, setVate] = useState(ate);

  // Voltar/avançar e links compartilhados devem restaurar os filtros da URL.
  useEffect(() => {
    setVq(q);
    setVord(ord || "");
    setVde(de);
    setVate(ate);
  }, [q, ord, de, ate]);

  const inverted = Boolean(vde && vate && vde > vate);
  const hasFilters = Boolean(vq || vord || vde || vate || q || ord || de || ate);

  const go = (e) => {
    e?.preventDefault();
    if (inverted) {
      finalDate.current?.focus();
      return;
    }
    const u = new URLSearchParams();
    if (vq.trim()) u.set("q", vq.trim());
    if (vord) u.set("ord", vord);
    if (vde) u.set("de", vde);
    if (vate) u.set("ate", vate);
    const qs = u.toString();
    router.push(qs ? `/campanha?${qs}` : "/campanha");
  };

  const clear = () => {
    setVq("");
    setVord("");
    setVde("");
    setVate("");
    router.push("/campanha");
  };

  return (
    <form onSubmit={go} className={styles.form} aria-label="Filtros do histórico">
      {/* Busca única (feedback rodada 2, L3): a cápsula da BarraBusca é o campo do nome e o
          botão "Filtrar"; Enter no campo submete este mesmo form. Datas e ordem ficam por baixo. */}
      <BarraBusca semForm name="q" value={vq} onChange={setVq} onClear={() => setVq("")}
        onSubmit={go} acao="Filtrar" placeholder="Buscar por nome do briefing…" ariaLabel="Nome do briefing" />
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Data inicial <span className="opcional">(opcional)</span></span>
          <input type="date" name="de" value={vde} max={vate || undefined}
            aria-describedby={`${id}-period${inverted ? ` ${id}-error` : ""}`}
            aria-invalid={inverted || undefined} onChange={(e) => setVde(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Data final <span className="opcional">(opcional)</span></span>
          <input type="date" name="ate" value={vate} min={vde || undefined} ref={finalDate}
            aria-describedby={`${id}-period${inverted ? ` ${id}-error` : ""}`}
            aria-invalid={inverted || undefined} onChange={(e) => setVate(e.target.value)} />
        </label>
        <div className={styles.order}>
          <FilterSelect label="Ordenar" value={vord} options={ORDENS}
            onChange={(v) => setVord(v || "")} />
        </div>
        {hasFilters && <div className={styles.actions}>
          <button type="button" className="psearch-clear" onClick={clear}>Limpar</button>
        </div>}
      </div>
      <p id={`${id}-period`} className={styles.hint}>Período de criação do briefing. Você pode preencher uma ou ambas as datas.</p>
      {inverted && <p id={`${id}-error`} className={styles.error} role="alert">A data final deve ser igual ou posterior à data inicial.</p>}
    </form>
  );
}
