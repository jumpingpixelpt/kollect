"use client";
import { useState } from "react";
import PainelPendente from "@/components/PainelPendente";
import { r2 } from "@/lib/numeros";
// Painel "Score KOL" — a nota do briefing L'Oréal em 3 camadas, explicada fator a fator.
// Recebe creators.kol_score inteiro: { geral (público feminino), masculino }.
// A saturação de concorrentes é camada SEPARADA (briefing §8.4): selo próprio, nunca desconta a nota.
//
// Alternador de eixo (jul/2026): o /api/kol-score sempre calculou os DOIS eixos do cliente
// (briefing §4 — o geral feminino e o masculino de capilar), mas o painel só mostrava o
// feminino. Um creator como um barbeiro com 31% de audiência feminina aparecia com a nota
// do eixo errado. Abre em feminino por ser o briefing geral e o público-alvo principal,
// igual ao default da BriefingBar. Client component só por causa deste estado.

const COR_NIVEL = {
  alta: "var(--red)",
  media: "var(--gold-bright)",
  baixa: "var(--green)",
  nenhuma: "var(--green)",
  sem_dados: "var(--text-faint)",
};
const LABEL_NIVEL = {
  alta: "Saturação alta", media: "Saturação média", baixa: "Saturação baixa",
  nenhuma: "Sem saturação", sem_dados: "Saturação sem dados",
};
const fmtData = (d) => {
  if (!d) return "";
  try { return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", ""); }
  catch { return d; }
};

const valido = (x) => !!x && Array.isArray(x.fatores) && Array.isArray(x.cortes);
const nota = (x) => (valido(x) && x.elegivel && x.score != null ? x.score : "—");

export default function KolScorePanel({ kolScore }) {
  const [eixo, setEixo] = useState("feminino");
  // aceita o objeto persistido { geral, masculino } ou um resultado direto de kolScore()
  const fem = valido(kolScore?.geral) ? kolScore.geral : (valido(kolScore) ? kolScore : null);
  const masc = valido(kolScore?.masculino) ? kolScore.masculino : null;
  const doisEixos = !!fem && !!masc;
  const r = eixo === "masculino" && masc ? masc : fem;
  if (!valido(r)) return <PainelPendente titulo="Score KOL" sub="régua relativa aos pares" passo="kol-score (/api/kol-score)" />;
  const sat = r.saturacao || { nivel: "sem_dados", evidencias: [], interna: [] };

  return (
    <div className="panel">
      <h3>Score KOL <span>· briefing em 3 camadas</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> a nota do briefing — corte de elegibilidade, score ponderado por fator e
        saturação de concorrentes como camada separada. <b>Por que acompanhar:</b> é a resposta a
        "por que este nome pontuou assim", fator a fator.
      </div>

      {/* eixo de audiência — os dois briefings do cliente (§4), calculados sempre os dois.
          Só a "Aderência de audiência" muda entre eixos (15% do score); os cortes de
          elegibilidade e os outros 4 fatores são iguais — daí o aviso por baixo. */}
      {doisEixos && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="rl-toggle">
            <button type="button" className={eixo === "feminino" ? "on" : ""} onClick={() => setEixo("feminino")}>
              ♀ Feminino · {nota(fem)}
            </button>
            <button type="button" className={eixo === "masculino" ? "on" : ""} onClick={() => setEixo("masculino")}>
              ♂ Masculino · {nota(masc)}
            </button>
          </div>
          <span style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
            Muda só a aderência de audiência — elegibilidade e restantes fatores são os mesmos.
          </span>
        </div>
      )}

      {/* nota + classe */}
      <div className="forecast-grid" style={{ marginBottom: 16 }}>
        <div className="forecast-cell">
          <div className="v">
            {r.elegivel && r.score != null ? r.score : "—"}
            <span style={{ fontSize: 14, color: "var(--text-faint)" }}>/100</span>
          </div>
          <div className="k">{r.elegivel ? `Score KOL · ${r.publico}` : "Inelegível — ver cortes"}</div>
        </div>
        <div className="forecast-cell">
          <div className="v" style={{ fontSize: 15, lineHeight: 1.35 }}>{r.classe_label || "Fora do corte"}</div>
          <div className="k">{r.classe_razao ? r.classe_razao.slice(0, 90) : "não entra na comparação"}</div>
        </div>
      </div>

      {/* Aviso de cobertura: um score de 62 medido com 3 fatores não é o mesmo que 62 medido
          com 5, mas sai igual no ecrã. Quando um fornecedor falha e a audiência não vem, é
          isto que impede a nota de ser lida como se fosse completa. */}
      {r.cobertura_pct != null && r.cobertura_pct < 100 && (
        <div style={{ border: "1px solid var(--gold-deep)", borderRadius: 4, padding: "10px 13px", marginBottom: 16, background: "var(--inset)" }}>
          <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", fontWeight: 700, color: "var(--gold-bright)" }}>
            Score parcial · {r2(r.cobertura_pct)}% dos critérios
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.55 }}>
            A nota foi calculada só com os fatores disponíveis e renormalizada para 0-100, por isso
            <b> não é diretamente comparável</b> com creators medidos por inteiro.
            {r.kol_nao_avaliavel && (
              <span style={{ color: "var(--red)" }}>
                {" "}Score e território cumprem o exigido para KOL, mas a autoridade não pôde ser calculada
                por falta de dados de audiência — <b>a classe KOL não foi avaliada, não foi recusada.</b>
              </span>
            )}
          </div>
        </div>
      )}

      {/* camada 1 — cortes (só em destaque quando reprovam) */}
      {!r.elegivel && (
        <div style={{ marginBottom: 16 }}>
          {r.cortes.filter((c) => !c.passou).map((c) => (
            <div className="pillar" key={c.id}>
              <div className="row">
                <span>{c.criterio} <span style={{ color: "var(--text-faint)" }}>— {c.razao}</span></span>
                <b style={{ color: "var(--red)", whiteSpace: "nowrap", textTransform: "uppercase", fontSize: 11, letterSpacing: "0.08em" }}>cortado</b>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* camada 2 — fatores com barras */}
      {r.fatores.map((f) => (
        <div className="pillar" key={f.id}>
          <div className="row">
            <span>
              {f.label} <span style={{ color: "var(--text-faint)" }}>· peso {f.disponivel ? `${f.peso_norm}%` : "—"}</span>
            </span>
            <b>{f.disponivel ? `${r2(f.nota)}` : "sem dados"}</b>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${f.disponivel ? Math.max(Math.min(f.nota, 100), 0) : 0}%`, opacity: f.disponivel ? 1 : 0.25 }} />
          </div>
        </div>
      ))}

      {/* camada 3 — selo de saturação, SEPARADO do score */}
      <div style={{ border: `1px solid ${COR_NIVEL[sat.nivel] || "var(--line)"}`, borderRadius: 4, padding: "12px 14px", margin: "18px 0 4px", background: "var(--inset)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 700, color: COR_NIVEL[sat.nivel] || "var(--text-dim)" }}>
            {LABEL_NIVEL[sat.nivel] || sat.nivel} · concorrentes
          </span>
          <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>camada de alerta — não desconta a nota</span>
        </div>
        {sat.evidencias?.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.6 }}>
            {sat.evidencias.slice(0, 4).map((e) => (
              <div key={`${e.marca}-${e.ultima}`}>
                {e.marca} <span style={{ color: "var(--text-faint)" }}>({e.grupo})</span> · {e.tipo}
                {e.videos ? ` · ${e.videos} vídeo${e.videos > 1 ? "s" : ""}` : ""}{e.ultima ? ` · último em ${fmtData(e.ultima)}` : ""}
              </div>
            ))}
          </div>
        )}
        {sat.interna?.length > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            Grupo L'Oréal (interna, não pontua): {sat.interna.map((e) => e.marca).join(" · ")}
          </div>
        )}
      </div>

      {/* razões por fator */}
      <details>
        <summary className="methodology-toggle">▸ Ver razões fator a fator</summary>
        <div style={{ paddingTop: 10 }}>
          {r.fatores.map((f) => (
            <div key={f.id} style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <b style={{ color: "var(--text)" }}>{f.label}:</b> {f.razao}
            </div>
          ))}
          {r.cortes.every((c) => c.passou) && (
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <b style={{ color: "var(--text)" }}>Elegibilidade:</b> {r.cortes.map((c) => c.razao).join(" ")}
            </div>
          )}
        </div>
      </details>

      <div className="formula-note">
        Score KOL {r.versao} · território {r.territorio} · público {r.publico} · calculado em {fmtData(r.calculado_em)}.
        {r.fatores_indisponiveis?.length ? ` Fatores sem dados (peso redistribuído): ${r.fatores_indisponiveis.join(", ")}.` : ""}
        {" "}Autoridade social em proxy v1 (audiência notável + credibilidade); menções externas na v2.
        Convive com o Radar Score: este mede o fit ao briefing, o Radar mede momentum de crescimento.
      </div>
    </div>
  );
}
