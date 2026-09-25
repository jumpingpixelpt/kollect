// A navegação pode mostrar o estado de carregamento enquanto a página consulta os
// dados. O shell e suas permissões continuam a ser resolvidos pelo layout autenticado.
export default function Loading() {
  return (
    <div className="wrap" role="status" aria-live="polite" aria-busy="true">
      <section className="panel" style={{ marginTop: 32, padding: 24 }}>
        <p style={{ margin: 0, color: "var(--text-dim)" }}>Carregando…</p>
      </section>
    </div>
  );
}
