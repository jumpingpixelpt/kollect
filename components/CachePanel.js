"use client";
import { useState } from "react";
// Cliente de browser COM sessão: o set_cache passou a exigir `authenticated`
// (era executável por anon, ou seja, qualquer pessoa escrevia o cachê).
import { supabaseBrowser } from "@/lib/auth";

const brl = (n) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n < 1 ? 3 : 0 }).format(n);

export default function CachePanel({ creatorId, initialCache, avgEngagements, engBasis, benchmarks }) {
  const [value, setValue] = useState(initialCache ?? "");
  const [saved, setSaved] = useState(initialCache ?? null);
  const [status, setStatus] = useState("idle");

  const cpe = saved && avgEngagements ? saved / avgEngagements : null;
  const verdict = cpe == null ? null : cpe < 0.08 ? ["barato pro mercado", "var(--green)"] : cpe < 0.25 ? ["dentro do mercado", "var(--gold-bright)"] : ["caro pro engajamento que entrega", "var(--red)"];

  async function save() {
    const num = parseFloat(String(value).replace(/\./g, "").replace(",", "."));
    if (!num || num <= 0) return;
    setStatus("saving");
    const { error } = await supabaseBrowser().rpc("set_cache", { p_creator: creatorId, p_value: num });
    if (error) { setStatus("error"); return; }
    setSaved(num);
    setStatus("ok");
    setTimeout(() => setStatus("idle"), 1800);
  }

  return (
    <div className="panel">
      <h3>Cachê & CPE <span>· custo por engajamento</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> quanto custa cada interação real que o creator entrega.
        <b> Por que acompanhar:</b> é a conta da janela — score alto com CPE abaixo dos pares é o melhor negócio do radar.
      </div>
      <div className="cache-row">
        <div className="cache-input">
          <span className="prefix">R$</span>
          <input
            type="text" inputMode="decimal" placeholder="cachê por vídeo"
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <button className="gold-btn" onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Salvando…" : status === "ok" ? "Salvo ✓" : status === "error" ? "Erro — tente de novo" : "Salvar"}
        </button>
      </div>
      <div className="forecast-grid" style={{ marginTop: 16 }}>
        <div className="forecast-cell">
          <div className="v">{saved ? brl(saved) : "—"}</div>
          <div className="k">Cachê por vídeo</div>
        </div>
        <div className="forecast-cell">
          <div className="v" style={verdict ? { color: verdict[1] } : {}}>{cpe != null ? brl(cpe) : "—"}</div>
          <div className="k">CPE — custo por engajamento</div>
        </div>
      </div>

      {cpe != null && benchmarks && (benchmarks.sizeMedian != null || benchmarks.nicheMedian != null) && (
        <div className="cpe-bench">
          {benchmarks.sizeMedian != null && (
            <BenchRow label={`Faixa ${benchmarks.sizeLabel}`} count={benchmarks.sizeCount} cpe={cpe} median={benchmarks.sizeMedian} />
          )}
          {benchmarks.nicheMedian != null && (
            <BenchRow label={`Nicho ${benchmarks.nicheLabel}`} count={benchmarks.nicheCount} cpe={cpe} median={benchmarks.nicheMedian} />
          )}
        </div>
      )}
      <div className="formula-note">
        CPE = cachê ÷ engajamentos médios por vídeo ({avgEngagements ? Math.round(avgEngagements).toLocaleString("pt-BR") : "—"} interações/vídeo{engBasis ? ` — ${engBasis}` : ""}).
        {verdict && <> Leitura: <span style={{ color: verdict[1] }}>{verdict[0]}</span>.</>} O benchmark é por contexto:
        CPE barato no nicho materno pode ser caro em games — por isso a comparação é com pares do mesmo tamanho e do mesmo nicho.
      </div>
    </div>
  );
}

function BenchRow({ label, count, cpe, median }) {
  const brlx = (n) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: n < 1 ? 3 : 0 }).format(n);
  const delta = (cpe / median - 1) * 100;
  const cheaper = delta < 0;
  const width = Math.min(100, (cpe / (Math.max(cpe, median) * 1.15)) * 100);
  const medWidth = Math.min(100, (median / (Math.max(cpe, median) * 1.15)) * 100);
  return (
    <div className="bench-row">
      <div className="bench-head">
        <span>{label} <span className="bench-n">· mediana de {count} creator{count > 1 ? "s" : ""}</span></span>
        <b style={{ color: cheaper ? "var(--green)" : "var(--red)" }}>
          {cheaper ? "" : "+"}{delta.toFixed(0)}% {cheaper ? "mais barato" : "mais caro"}
        </b>
      </div>
      <div className="bench-bars">
        <div className="bench-bar">
          <span className="bench-tag">ele</span>
          <div className="track"><div className="fill" style={{ width: `${width}%` }} /></div>
          <span className="bench-val">{brlx(cpe)}</span>
        </div>
        <div className="bench-bar dim">
          <span className="bench-tag">pares</span>
          <div className="track"><div className="fill" style={{ width: `${medWidth}%`, opacity: 0.45 }} /></div>
          <span className="bench-val">{brlx(median)}</span>
        </div>
      </div>
    </div>
  );
}
