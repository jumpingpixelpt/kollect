import styles from "./BigNumbers.module.css";

/**
 * Faixa de big numbers (feedback rodada 2, set/2026): "big numbers sempre antes da
 * explicação, em qualquer tela ou card". O número vem primeiro e grande; o rótulo por baixo;
 * a explicação, quando existe, fica numa linha curta (`sub`) ou no title.
 *
 * items: [{ label, value, sub?, title?, destaque? }]. value null/"" mostra "—".
 * compacto: versão mais baixa, para cards e cabeçalhos de lista.
 */
export default function BigNumbers({ items = [], compacto = false, className = "", ariaLabel }) {
  const vis = items.filter(Boolean);
  if (!vis.length) return null;
  return (
    <dl className={`${styles.faixa} ${compacto ? styles.compacto : ""} ${className}`} aria-label={ariaLabel}>
      {vis.map((it) => (
        <div key={it.label} className={`${styles.item} ${it.destaque ? styles.destaque : ""}`} title={it.title}>
          <dd className={styles.valor}>{it.value == null || it.value === "" ? "—" : it.value}</dd>
          <dt className={styles.label}>{it.label}</dt>
          {it.sub && <dd className={styles.sub}>{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
