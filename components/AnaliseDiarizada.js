"use client";
import { useMemo, useState } from "react";
import { diaCurto as dia } from "@/lib/datas";

/**
 * ANÁLISE DIARIZADA — duas métricas do histórico de snapshots, sobrepostas e escolhíveis.
 *
 * O eixo X é uma escala de TEMPO, não uma fila de pontos igualmente espaçados: os
 * snapshots desta base são irregulares (a importação de junho, depois o cron diário) e um
 * eixo por índice desenharia esse buraco como se fosse continuidade. O espaço vazio no
 * meio da linha é informação — quer dizer que não se mediu nada nesses dias.
 *
 * Cada série tem a sua própria escala, porque seguidores e engajamento não partilham
 * unidade; por isso cada uma tem o seu eixo, com a cor da linha. Os rótulos do eixo ganham
 * casas decimais até serem três valores distintos: "12k · 12k · 12k" num eixo de 11,8k a
 * 12,2k é um eixo sem informação.
 *
 * O período é escolhível (histórico inteiro · 12 meses · 90 · 30 dias) e conta-se a partir
 * de HOJE, não do último snapshot: "últimos 30 dias" com o último ponto em junho é um
 * período vazio, e a opção fica desativada em vez de mostrar dois pontos velhos como se
 * fossem o mês. A predefinição é o histórico inteiro porque é essa forma — a importação de
 * junho, o buraco, o cron diário — que conta a história certa desta base.
 */

const fmtN = (n, d) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(d ?? 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(d ?? (a < 1e4 ? 1 : 0)) + "k";
  return d == null ? String(Math.round(n * 10) / 10) : n.toFixed(d);
};
// `fmt(v, d)`: sem `d` é a precisão natural da série; `decs` são as casas a tentar, por
// ordem, quando os três rótulos do eixo saem iguais.
const SERIES = [
  { k: "followers", label: "Seguidores", fmt: (v, d) => fmtN(v, d), decs: [1, 2, 3] },
  { k: "avg_views", label: "Views médias", fmt: (v, d) => fmtN(v, d), decs: [1, 2, 3] },
  { k: "eng_rate", label: "Engajamento (%)", fmt: (v, d = 2) => `${Number(v).toFixed(d)}%`, decs: [3, 4] },
  { k: "saves_per_1k", label: "Saves / 1k views", fmt: (v, d = 1) => Number(v).toFixed(d), decs: [2, 3] },
  { k: "shares_per_1k", label: "Shares / 1k views", fmt: (v, d = 1) => Number(v).toFixed(d), decs: [2, 3] },
];
const PERIODOS = [["tudo", "Todo o histórico"], ["365", "12 meses"], ["90", "90 dias"], ["30", "30 dias"]];
const COR_A = "#f0d77b", COR_B = "#7aa7d8";

const t = (d) => new Date(String(d).slice(0, 10) + "T12:00:00").getTime();

export default function AnaliseDiarizada({ snaps }) {
  const [a, setA] = useState("followers");
  const [b, setB] = useState("eng_rate");
  const [periodo, setPeriodo] = useState("tudo");
  const [hover, setHover] = useState(null);

  const todos = useMemo(() => (snaps || []).filter((s) => s.captured_at), [snaps]);
  const hoje = Date.now();
  const desde = (p) => (p === "tudo" ? -Infinity : hoje - Number(p) * 864e5);
  const conta = (p) => todos.filter((s) => t(s.captured_at) >= desde(p)).length;
  const pontos = periodo === "tudo" ? todos : todos.filter((s) => t(s.captured_at) >= desde(periodo));

  if (todos.length < 2) {
    return (
      <div className="panel">
        <h3>Análise diarizada <span>· histórico medido</span></h3>
        <div className="fc-vazio">
          {todos.length === 1
            ? "Apenas um snapshot medido — com um ponto não há curva. Os snapshots diários do radar engrossam esta linha a partir de agora."
            : "Sem snapshots deste creator — a curva aparece assim que o radar medir a conta pela primeira vez."}
        </div>
      </div>
    );
  }

  const W = 900, H = 280, padL = 54, padR = 54, padT = 16, padB = 34;
  const t0 = t(pontos[0].captured_at), t1 = t(pontos.at(-1).captured_at);
  const x = (d) => padL + ((t(d) - t0) / (t1 - t0 || 1)) * (W - padL - padR);

  const serie = (k) => {
    if (!k) return null;
    const def = SERIES.find((s) => s.k === k);
    const vals = pontos.map((p) => ({ d: p.captured_at, v: p[k] == null ? null : Number(p[k]) })).filter((p) => p.v != null && Number.isFinite(p.v));
    if (vals.length < 2) return null;
    const min = Math.min(...vals.map((v) => v.v)), max = Math.max(...vals.map((v) => v.v));
    const folga = (max - min || Math.abs(max) || 1) * 0.15;
    // nenhuma destas métricas é negativa — sem o piso, o eixo do engajamento escrevia "-0.04%"
    const lo = Math.max(min >= 0 ? 0 : -Infinity, min - folga), hi = max + folga;
    const y = (v) => H - padB - ((v - lo) / (hi - lo || 1)) * (H - padT - padB);
    return { def, vals, y, lo, hi, min, max, plano: max - min < 1e-9 };
  };
  // três rótulos distintos, com a precisão natural primeiro e mais casas só se for preciso
  const rotulos = (s) => {
    const vals = [s.lo, (s.lo + s.hi) / 2, s.hi];
    for (const d of [undefined, ...s.def.decs]) {
      const l = vals.map((v) => s.def.fmt(v, d));
      if (new Set(l).size === 3) return vals.map((v, i) => [v, l[i]]);
    }
    return vals.map((v) => [v, s.def.fmt(v, s.def.decs.at(-1))]);
  };

  const sa = serie(a), sb = serie(b === a ? null : b);
  const path = (s) => s.vals.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${s.y(p.v).toFixed(1)}`).join(" ");

  // rótulos do eixo X pela DATA (4 marcas), não por índice
  const marcas = [0, 1, 2, 3].map((i) => new Date(t0 + ((t1 - t0) * i) / 3));
  const comAno = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  const planas = [sa, sb].filter((s) => s?.plano).map((s) => s.def.label);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let melhor = null;
    for (const p of pontos) { const d = Math.abs(x(p.captured_at) - px); if (!melhor || d < melhor.d) melhor = { d, p }; }
    setHover(melhor && melhor.d < 40 ? melhor.p : null);
  };

  return (
    <div className="panel">
      <div className="fc-diar-head">
        <div>
          <h3 style={{ marginBottom: 4 }}>Análise diarizada <span>· {dia(pontos[0].captured_at, comAno)} a {dia(pontos.at(-1).captured_at, comAno)}</span></h3>
          <div className="fc-diar-sub">{pontos.length} snapshots medidos{pontos.length !== todos.length ? ` · de ${todos.length} no histórico` : ""}</div>
        </div>
        <div className="fc-diar-sel">
          <select value={periodo} onChange={(e) => { setPeriodo(e.target.value); setHover(null); }} aria-label="Período">
            {PERIODOS.map(([p, label]) => {
              const n = conta(p);
              return <option key={p} value={p} disabled={n < 2} title={n < 2 ? "menos de dois snapshots neste período" : undefined}>{label}{n < 2 ? " — sem medições" : ""}</option>;
            })}
          </select>
          <select value={a} onChange={(e) => setA(e.target.value)} aria-label="Série principal">
            {SERIES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
          <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Série secundária">
            <option value="">— nenhuma —</option>
            {SERIES.filter((s) => s.k !== a).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="fc-diar-leg">
        {sa && <span><i style={{ background: COR_A }} />{sa.def.label}</span>}
        {sb && <span><i style={{ background: COR_B }} />{sb.def.label}</span>}
      </div>

      {!sa && !sb ? (
        <div className="fc-vazio">Nenhuma das séries escolhidas tem dois valores medidos neste período — escolhe outra métrica ou alarga o período.</div>
      ) : (
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const yy = padT + f * (H - padT - padB);
            return <line key={f} x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="rgba(212,175,55,0.10)" strokeDasharray="3 5" />;
          })}

          {sa && rotulos(sa).map(([v, l], i) => (
            <text key={`a${i}`} x={padL - 8} y={sa.y(v) + 3.5} textAnchor="end" fontSize="10.5" fill={COR_A} opacity="0.75">{l}</text>
          ))}
          {sb && rotulos(sb).map(([v, l], i) => (
            <text key={`b${i}`} x={W - padR + 8} y={sb.y(v) + 3.5} textAnchor="start" fontSize="10.5" fill={COR_B} opacity="0.75">{l}</text>
          ))}

          {marcas.map((d, i) => (
            <text key={i} x={x(d.toISOString().slice(0, 10))} y={H - 10} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} fontSize="10.5" style={{ fill: "var(--text-faint)" }}>
              {dia(d.toISOString().slice(0, 10), comAno)}
            </text>
          ))}

          {sb && <path d={path(sb)} fill="none" stroke={COR_B} strokeWidth="2" strokeLinejoin="round" opacity="0.9" />}
          {sa && <path d={path(sa)} fill="none" stroke={COR_A} strokeWidth="2.2" strokeLinejoin="round" />}

          {pontos.map((p) => (
            <circle key={p.captured_at} cx={x(p.captured_at)} cy={H - padB + 6} r="1.6" style={{ fill: "var(--text-faint)" }} />
          ))}

          {hover && (
            <>
              <line x1={x(hover.captured_at)} x2={x(hover.captured_at)} y1={padT} y2={H - padB} style={{ stroke: "var(--text)", strokeOpacity: 0.25 }} />
              {sa && hover[a] != null && <circle cx={x(hover.captured_at)} cy={sa.y(Number(hover[a]))} r="4" style={{ fill: "var(--card)" }} stroke={COR_A} strokeWidth="2" />}
              {sb && hover[b] != null && <circle cx={x(hover.captured_at)} cy={sb.y(Number(hover[b]))} r="4" style={{ fill: "var(--card)" }} stroke={COR_B} strokeWidth="2" />}
            </>
          )}
        </svg>

        {hover && (
          <div className="chart-tip" style={{ left: `${(x(hover.captured_at) / W) * 100}%` }}>
            <div className="tip-label">{dia(hover.captured_at)}</div>
            {sa && <div className="tip-value" style={{ color: COR_A }}>{hover[a] == null ? "—" : sa.def.fmt(Number(hover[a]))}</div>}
            {sb && <div className="tip-value" style={{ color: COR_B, fontSize: 15 }}>{hover[b] == null ? "—" : sb.def.fmt(Number(hover[b]))}</div>}
          </div>
        )}
      </div>
      )}

      <div className="formula-note">
        Os pontos por baixo do eixo marcam os dias em que houve medição — o espaço entre eles é tempo sem snapshot, não estabilidade.
        {planas.length ? ` ${planas.join(" e ")} ${planas.length > 1 ? "estão" : "está"} numa linha reta porque ${planas.length > 1 ? "os valores medidos não variaram" : "o valor medido não variou"} no período.` : ""}
      </div>
    </div>
  );
}
