"use client";
import styles from "./BarraBusca.module.css";

/**
 * A barra de busca única da plataforma (feedback rodada 2, set/2026): "busca idêntica em
 * todas as páginas" — Busca, Creators, Squad, Histórico e Creators Hub desenham esta mesma
 * cápsula. O que muda por página é o que ela procura, não a aparência.
 *
 * Só desenha. Quem usa decide o estado (controlado por value/onChange) e o que o submit faz;
 * com `name` e sem onSubmit funciona dentro de um <form method="get"> normal.
 *
 * - `acao`: rótulo do botão (padrão "Buscar"); `acao={null}` tira o botão.
 * - `busy`: mostra o anel de atividade no campo.
 * - `extra`: nós à direita, antes do botão (ex.: botão de anexo da Busca).
 * - `children`: por baixo da cápsula (filtros, dicas).
 */
const Lupa = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" />
  </svg>
);

export default function BarraBusca({
  value, onChange, onSubmit, onClear, name, placeholder = "Buscar…", ariaLabel,
  acao = "Buscar", busy = false, extra = null, children = null, className = "",
  inputProps = {}, formProps = {}, semForm = false,
}) {
  const campo = (
    <div className={styles.shell}>
      <span className={styles.lupa}><Lupa /></span>
      <input
        className={styles.input} type="search" name={name} value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder} aria-label={ariaLabel || placeholder} autoComplete="off"
        {...inputProps}
      />
      {busy && <span className={styles.busy} aria-label="a procurar" />}
      {!busy && onClear && !!value && (
        <button type="button" className={styles.limpar} onClick={onClear} aria-label="Limpar busca">×</button>
      )}
      {extra}
      {acao && (
        <button type={semForm ? "button" : "submit"} className={styles.botao} onClick={semForm ? onSubmit : undefined}>
          <Lupa /><span>{acao}</span>
        </button>
      )}
    </div>
  );

  return (
    <div className={`${styles.barra} ${className}`}>
      {semForm ? campo : (
        <form role="search" onSubmit={onSubmit ? (e) => { e.preventDefault(); onSubmit(); } : undefined} {...formProps}>
          {campo}
        </form>
      )}
      {children}
    </div>
  );
}
