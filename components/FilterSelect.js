"use client";

/**
 * O dropdown do design — etiqueta por cima, seta dourada desenhada por nós.
 *
 * Vivia como função local dentro do FilterBar, portanto quem precisasse de um dropdown noutro
 * ecrã copiava o markup ou improvisava. Foi o que aconteceu no ProspectSearch: um <select> com
 * a classe `psearch-n`, que só estiliza <input> (`.psearch input { … }`), caía no controlo
 * nativo do browser — canto direito, seta do sistema, nada do tema. Mesmo padrão de erro do
 * `.chip` sem `background`: uma classe pensada para uma tag aplicada a outra.
 *
 * Estando aqui, os dois usam o mesmo e não se podem desalinhar outra vez.
 *
 * `options` é uma lista de pares [valor, texto]. O valor null vale como "sem filtro" e sai
 * como string vazia no <select> (o DOM não guarda null), voltando a null no onChange.
 */
export default function FilterSelect({ label, value, options, onChange, minWidth }) {
  return (
    <label className="filter-group">
      <span className="filter-label">{label}</span>
      <span className="filter-select-wrap">
        <select
          className="filter-select"
          value={value || ""}
          style={minWidth ? { minWidth } : undefined}
          onChange={(e) => onChange(e.target.value || null)}
        >
          {options.map(([v, t]) => <option key={v ?? "all"} value={v ?? ""}>{t}</option>)}
        </select>
        <span className="filter-caret">▾</span>
      </span>
    </label>
  );
}
