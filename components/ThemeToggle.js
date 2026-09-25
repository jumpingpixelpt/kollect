"use client";
import { useEffect, useState } from "react";
import { THEME_KEY, aplicarTema, temaAtual } from "@/lib/theme";

// Botão Claro ⇄ Escuro (o claro é o padrão). O <html> já vem com o tema certo (script inline de app/layout.js),
// por isso o estado inicial lê-se do DOM depois de montar — sem hidratação divergente.
// `compact` = só o ícone (canto do /login); por defeito mostra o rótulo (rodapé da sidebar).
export default function ThemeToggle({ compact = false }) {
  const [tema, setTema] = useState("light");

  useEffect(() => {
    setTema(temaAtual());
    // outra aba mudou o tema: acompanha, para não ficarem duas abas em temas diferentes
    const sync = (e) => { if (e.key === THEME_KEY) setTema(aplicarTema(e.newValue === "dark" ? "dark" : "light")); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function trocar() {
    const novo = tema === "light" ? "dark" : "light";
    aplicarTema(novo);
    try { localStorage.setItem(THEME_KEY, novo); } catch {}
    setTema(novo);
  }

  const claro = tema === "light";
  const rotulo = claro ? "Tema escuro" : "Tema claro";
  return (
    <button
      type="button"
      className={`theme-toggle${compact ? " compact" : ""}`}
      onClick={trocar}
      aria-label={compact ? rotulo : undefined}
      title={claro ? "Mudar para o tema escuro" : "Mudar para o tema claro"}
    >
      <span className="tt-ico" aria-hidden="true">{claro ? "☾" : "☼"}</span>
      {!compact && <span>{rotulo}</span>}
    </button>
  );
}
