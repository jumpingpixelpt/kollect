"use client";
import { useState } from "react";
import { NIVEL_LABEL } from "@/lib/disaster";
import { diaCurto } from "@/lib/datas";

/**
 * DISASTER CHECK — o que a varredura encontrou no conteúdo que temos.
 *
 * Feedback do cliente (set/2026, ponto 18): só aparece o que foi efetivamente verificado.
 * Cada alerta traz a peça que o gerou, a data da publicação e o trecho. Saíram o subtítulo
 * "risco reputacional", os blocos "O que é / Por que acompanhar", a linha de cobertura
 * ("8 peças · 8 com fala · bio incluída") e as categorias que exigem fontes que não temos
 * (antecedentes, cargo público, menoridade) — apresentar "não verificado" ao cliente
 * sugeria uma cobertura que a plataforma não tem.
 *
 * A honestidade que fica: sem uma única peça com texto, o veredicto é "não verificado",
 * nunca "nada encontrado". E termo encontrado não é veredicto — fica "a rever", com o
 * trecho à vista, para leitura humana.
 */

const COR = { limpo: "var(--green)", baixo: "var(--green)", medio: "var(--gold-bright)", alto: "var(--red)", sem_base: "var(--text-faint)" };

export default function DisasterCheck({ check }) {
  const [aberto, setAberto] = useState(false);
  if (!check) return null;

  const { risco, nivel, categorias, semBase } = check;
  const cor = COR[nivel] ?? "var(--text-dim)";
  const sinais = categorias.filter((c) => c.estado === "sinal");
  const r = 30, c2 = 2 * Math.PI * r;
  const pct = semBase ? 0 : Math.min(risco, 100) / 100;

  return (
    <div className="panel">
      <h3>Disaster Check</h3>

      <div className="fc-risk-head">
        <svg viewBox="0 0 68 68" className="fc-risk-ring" aria-hidden="true">
          <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(212,175,55,0.15)" strokeWidth="4" />
          <circle cx="34" cy="34" r={r} fill="none" stroke={cor} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${c2 * pct} ${c2}`} transform="rotate(-90 34 34)" />
          <text x="34" y="38" textAnchor="middle" fontSize="18" fill="var(--text)" fontFamily="var(--serif)">{semBase ? "—" : sinais.length}</text>
        </svg>
        <div>
          <div className="fc-risk-l" style={{ color: cor }}>
            {semBase ? "Não verificado" : NIVEL_LABEL[nivel]}
          </div>
          <div className="fc-risk-s">
            {semBase
              ? "Nenhuma peça com texto importada — nada foi varrido. Ausência de achados aqui não é ausência de risco."
              : sinais.length
                ? `${sinais.length} categoria${sinais.length > 1 ? "s" : ""} com termos a rever: ${sinais.map((s) => s.nome.toLowerCase()).join(", ")}.`
                : `Nenhum termo sinalizado nas ${categorias.length} categorias varridas.`}
          </div>
        </div>
      </div>

      {/* os alertas ficam sempre à vista; o detalhe das categorias limpas abre a pedido */}
      {sinais.length > 0 && (
        <div className="fc-risk-grid" style={{ marginTop: 14 }}>
          {sinais.map((cat) => <Categoria key={cat.id} cat={cat} />)}
        </div>
      )}

      {!semBase && (
        <button className="chip" onClick={() => setAberto((v) => !v)} style={{ marginTop: sinais.length ? 14 : 0 }}>
          {aberto ? "Ocultar categorias verificadas ▲" : "Ver categorias verificadas ▼"}
        </button>
      )}

      {aberto && (
        <div className="fc-risk-grid">
          {categorias.filter((cat) => cat.estado !== "sinal").map((cat) => <Categoria key={cat.id} cat={cat} />)}
        </div>
      )}
    </div>
  );
}

function Categoria({ cat }) {
  return (
    <div className={`fc-risk-c${cat.estado === "sinal" ? " sinal" : ""}`}>
      <div className="fc-risk-c-h">{cat.nome}</div>
      <div className={`fc-risk-c-v ${cat.estado === "sinal" ? "fc-baixo" : "fc-alto"}`}>
        {cat.estado === "sinal" ? "▲ A REVER" : "✓ NADA ENCONTRADO"}
        {cat.tipo !== "risco" && <i> · {cat.tipo === "restricao" ? "restrição de campanha" : "contexto"}</i>}
      </div>
      <div className="fc-risk-c-d">{cat.detalhe}</div>
      {cat.evidencias.map((e, i) => (
        <div className="fc-risk-ev" key={i}>
          {e.trecho}
          <div className="fc-risk-ev-d">
            {e.bio ? "na bio" : e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">ver a peça ↗</a> : "numa peça"}
            {e.data ? ` · publicada em ${diaCurto(e.data, true)}` : ""}
          </div>
        </div>
      ))}
      {cat.nota && <div className="fc-risk-c-n">{cat.nota}</div>}
    </div>
  );
}
