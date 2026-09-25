import styles from "./CreatorsHubWorkspace.module.css";

/**
 * Moldura do Creators Hub. Tinha uma barra de abas — Creators · Top Conteúdos do Creator ·
 * Mood Board — que saiu na rodada 2 de feedback (F3.3, set/2026): o Hub fica só com a lista
 * de creators, e os dois blocos passaram para dentro da ficha (/creator/<id>#top e #mood),
 * em rolo. Os links antigos ?aba=…&creator=… são redirecionados em
 * app/(app)/creators-hub/page.js.
 */
export default function CreatorsHubWorkspace({ children }) {
  return <div className={styles.workspace}>{children}</div>;
}
