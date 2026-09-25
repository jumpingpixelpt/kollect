"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Dropdown de seleção múltipla no traje do FilterSelect: etiqueta por cima, caixa
 * .filter-select, seta dourada — mas o painel é de checkboxes, porque um <select
 * multiple> nativo obriga a ctrl-clique e não mostra o que está marcado.
 *
 * `options` é uma lista de pares [valor, texto]; `values` é a seleção atual.
 * Lista vazia vale como "todos" (sem filtro) — o mesmo contrato do valor null no
 * FilterSelect. Fecha no clique fora; a aplicação do filtro fica com o formulário.
 */
export default function FilterMultiSelect({ label, values = [], options, onChange, minWidth, allLabel = "Todos" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = (v) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  // com 1 só marcado, a caixa mostra o RÓTULO da opção (não o valor cru — que pode
  // ser uma chave de motor tipo "ai:unhas")
  const labelOf = (v) => options.find((o) => o[0] === v)?.[1] ?? v;
  const resumo = !values.length ? allLabel : values.length === 1 ? labelOf(values[0]) : `${values.length} selecionados`;

  return (
    <div className="filter-group" ref={ref} style={{ position: "relative" }}>
      <span className="filter-label">{label}</span>
      <span className="filter-select-wrap">
        <button type="button" className="filter-select" style={{ minWidth, textAlign: "left" }}
          onClick={() => setOpen(!open)} aria-expanded={open}>
          {resumo}
        </button>
        <span className="filter-caret">▾</span>
      </span>
      {open && (
        <div className="fms-panel">
          <label className="fms-opt">
            <input type="checkbox" checked={!values.length} onChange={() => onChange([])} />
            {allLabel}
          </label>
          {options.map(([v, t]) => (
            <label key={v} className="fms-opt">
              <input type="checkbox" checked={values.includes(v)} onChange={() => toggle(v)} />
              {t}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
