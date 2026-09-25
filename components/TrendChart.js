"use client";
import { useState } from "react";

const fmt = (n) => n == null ? "—"
  : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(Math.abs(n) < 1e4 ? 1 : 0) + "k"
  : String(Math.round(n * 10) / 10);

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const candidates = [step, step * 2, step * 2.5, step * 5, step * 10];
  const s = candidates.find((c) => span / c <= count + 1) || step * 10;
  const start = Math.ceil(min / s) * s;
  const ticks = [];
  for (let v = start; v <= max + 1e-9; v += s) ticks.push(v);
  return ticks;
}

/**
 * Gráfico estilo Google Trends: eixos, gridlines, área, tooltip no hover
 * e projeção tracejada de forecast.
 * points: [{ label, value }] · forecastPoints: [{ label, value }] (opcional)
 */
export default function TrendChart({ points, forecastPoints = [], unit = "", id = "tc" }) {
  const [hover, setHover] = useState(null);
  if (!points?.length) return null;

  const W = 660, H = 250, padL = 52, padR = 16, padT = 14, padB = 30;
  const all = [...points, ...forecastPoints];
  const vals = all.map((p) => p.value);
  const min = Math.min(...vals, 0 > Math.min(...vals) ? Math.min(...vals) : Math.min(...vals) * 0.92);
  const max = Math.max(...vals) * 1.06;
  const n = all.length;
  const x = (i) => padL + (i * (W - padL - padR)) / (n - 1 || 1);
  const y = (v) => H - padB - ((v - min) / (max - min || 1)) * (H - padT - padB);

  const ticks = niceTicks(min, max, 4);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${H - padB} L${x(0)},${H - padB} Z`;
  const fcPath = forecastPoints.length
    ? [`M${x(points.length - 1)},${y(points.at(-1).value)}`, ...forecastPoints.map((p, i) => `L${x(points.length + i)},${y(p.value)}`)].join(" ")
    : null;

  // labels do eixo X: ~4 espaçados (só nos pontos reais)
  const xIdx = [0, Math.round((points.length - 1) / 3), Math.round((2 * (points.length - 1)) / 3), points.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const hp = hover != null ? all[hover] : null;
  const isFc = hover != null && hover >= points.length;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(212,175,55,0.13)" />
            <stop offset="100%" stopColor="rgba(212,175,55,0)" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgba(212,175,55,0.10)" strokeDasharray="3 5" />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" style={{ fill: "var(--text-faint)" }}>{fmt(t)}</text>
          </g>
        ))}

        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10.5" style={{ fill: "var(--text-faint)" }}>{points[i].label}</text>
        ))}

        <path d={area} fill={`url(#${id}-a)`} />
        <path d={path} fill="none" stroke="#d4af37" strokeWidth="2.2" strokeLinejoin="round" />
        {fcPath && <path d={fcPath} fill="none" stroke="#f0d77b" strokeWidth="2" strokeDasharray="5 5" opacity="0.8" />}
        <circle cx={x(points.length - 1)} cy={y(points.at(-1).value)} r="3.5" fill="#f0d77b" />

        {hover != null && hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} style={{ stroke: "var(--text)", strokeOpacity: 0.25 }} />
            <circle cx={x(hover)} cy={y(hp.value)} r="4.5" style={{ fill: "var(--card)" }} stroke="#f0d77b" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover != null && hp && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="tip-label">{hp.label}{isFc ? " · projeção" : ""}</div>
          <div className="tip-value">{fmt(hp.value)}{unit}</div>
        </div>
      )}
    </div>
  );
}
