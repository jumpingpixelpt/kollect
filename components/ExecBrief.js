"use client";
import PainelPendente from "@/components/PainelPendente";
import { useState } from "react";

function ScoreCard({ label, value, read, suffix }) {
  const v = value == null ? "—" : value;
  return (
    <div className="exg-score">
      <div className={`exg-score-v ${typeof value === "number" || /^[\d—]/.test(String(value)) ? "" : "exg-score-txt"}`}>{v}{value != null && suffix ? <span className="exg-suf">{suffix}</span> : null}</div>
      <div className="exg-score-l">{label}</div>
      {read && <div className="exg-score-r">{read}</div>}
    </div>
  );
}

export default function ExecBrief({ brief, scores, fits, part = "snapshot" }) {
  const [showDef, setShowDef] = useState(false);
  if (!brief) return part === "snapshot"
    ? <PainelPendente titulo="Decision Snapshot" sub="dossiê executivo" passo="brief (/api/exec-brief)" nota="Depende do kol-screen, do histórico de marcas e do brand fit — corre depois deles na cadeia." />
    : <PainelPendente titulo="Activation Intelligence" sub="como usar esta creator" passo="brief (/api/exec-brief)" />;
  const s = scores || {};

  return (
    <section className="exg">
      {part === "snapshot" && (<>
      {/* ───── Scores principais ───── */}
      <div className="exg-scores">
        {/* "força no território" descrevia o score composto do screening que aqui estava antes.
            O valor passou a ser o fator Autoridade do §8 — proxy v1: audiência notável e
            credibilidade — e a legenda tem de dizer o que se está a medir. */}
        <ScoreCard label="Creator Authority" value={s.authority} read="audiência notável e credibilidade" />
        <ScoreCard label="Brand Fit" value={s.brandFit} read={s.brandFitName || "melhor marca"} />
        <ScoreCard label="Growth Status" value={s.momentum} read={s.momentumRead} />
        <ScoreCard label="Audience" value={s.audience} suffix="%" read="credibilidade" />
        <ScoreCard label="Risk" value={s.riskLabel} read={s.riskRead} />
      </div>

      {/* ───── Executive Recommendation ───── */}
      <div className="exg-rec">
        <div className="exg-tag">◆ Executive Recommendation</div>
        <div className="exg-grid2">
          <div><span className="exg-k">Recommended role</span><span className="exg-val">{brief.recommended_role}</span></div>
          <div><span className="exg-k">Best use</span><span className="exg-val">{brief.best_use}</span></div>
          <div><span className="exg-k">Best fit for</span><span className="exg-val">{(brief.best_fit || []).join(" · ")}</span></div>
          <div><span className="exg-k">Not ideal for</span><span className="exg-val exg-dim">{brief.not_ideal_for}</span></div>
        </div>

        {brief.why_enters?.length > 0 && (
          <>
            <div className="exg-sub">Why she enters</div>
            <ol className="exg-why">
              {brief.why_enters.map((w, i) => (
                <li key={i}><b>{w.t}:</b> {w.d}</li>
              ))}
            </ol>
          </>
        )}

        {brief.casting_role && (
          <div className="exg-cast">
            <span><b>Primary role</b> {brief.casting_role.primary}</span>
            <span><b>Secondary</b> {brief.casting_role.secondary}</span>
            <span><b>Funnel</b> {brief.casting_role.funnel}</span>
            <span><b>Placement</b> {brief.casting_role.placement}</span>
          </div>
        )}

        {brief.client_defense && (
          <div className="exg-defense">
            <button className="gold-btn crm-btn" onClick={() => setShowDef((v) => !v)}>
              {showDef ? "Ocultar Client Defense" : "◆ Gerar Client Defense"}
            </button>
            {showDef && (
              <div className="exg-defense-body">
                <p>{brief.client_defense}</p>
                <button className="ghost-btn crm-btn" onClick={() => navigator.clipboard?.writeText(brief.client_defense)} style={{ marginTop: 10 }}>Copiar defesa</button>
              </div>
            )}
          </div>
        )}
      </div>

      </>)}

      {part === "activation" && (brief.use_cases?.length || brief.do?.length || brief.watchouts?.length) ? (
        <div className="exg-cols">
          {brief.use_cases?.length > 0 && (
            <div className="exg-card">
              <div className="exg-ctitle">Best use cases</div>
              {brief.use_cases.map((u, i) => (
                <div className="exg-uc" key={i}>
                  <b>{u.t}</b>
                  <span>{u.d}</span>
                  {u.best_for && <span className="exg-uc-l"><em>Best for:</em> {u.best_for}</span>}
                  {u.why_fits && <span className="exg-uc-l"><em>Why it fits:</em> {u.why_fits}</span>}
                </div>
              ))}
            </div>
          )}
          {(brief.do?.length || brief.dont?.length) ? (
            <div className="exg-card">
              <div className="exg-ctitle">Creative guidelines</div>
              {brief.do?.length > 0 && <div className="exg-dod"><span className="exg-do">Do</span><ul>{brief.do.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
              {brief.dont?.length > 0 && <div className="exg-dod"><span className="exg-dont">Don't</span><ul>{brief.dont.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
            </div>
          ) : null}
          {brief.watchouts?.length > 0 && (
            <div className="exg-card">
              <div className="exg-ctitle">Strategic Watchouts</div>
              <ul className="exg-watch">{brief.watchouts.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
