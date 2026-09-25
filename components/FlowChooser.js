"use client";
import { useState } from "react";
import EvaluateBar from "./EvaluateBar";
import BriefingBar from "./BriefingBar";

/**
 * Hero com os DOIS fluxos de entrada no mesmo peso visual.
 * Antes da escolha, nenhum aparece como padrão: dois cards lado a lado.
 * Ao clicar, o fluxo correspondente expande na própria página (sem modal).
 */
export default function FlowChooser({ fixos = [] }) {
  const [mode, setMode] = useState(null);

  if (mode) {
    return (
      <div className="flow-active">
        <button className="flow-back" onClick={() => setMode(null)}>← Trocar de caminho</button>
        {mode === "perfil" ? <EvaluateBar /> : <BriefingBar embedded fixos={fixos} />}
      </div>
    );
  }

  return (
    <div className="flow-cards">
      <button className="flow-card" onClick={() => setMode("perfil")}>
        <span className="flow-ic">⌖</span>
        <span className="flow-t">Avaliar perfil</span>
        <span className="flow-d">Cole o link de um creator e receba o dossiê completo com Radar Score.</span>
      </button>
      <button className="flow-card" onClick={() => setMode("briefing")}>
        <span className="flow-ic">✦</span>
        <span className="flow-t">Briefing Match</span>
        <span className="flow-d">Cole o briefing da campanha e receba o casting de creators sob medida.</span>
      </button>
    </div>
  );
}
