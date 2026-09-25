"use client";
import { useEffect, useRef } from "react";

/**
 * Fundo animado da plataforma (feedback rodada 2, set/2026): "bolinhas se mexendo, dando ar
 * de plataforma de IA". Pontos que derivam devagar e se ligam por fios finos quando ficam
 * perto — substitui a grelha em movimento do .app-backdrop, que continua a dar os brilhos.
 *
 * Custos contidos: no máximo 70 pontos (menos em ecrãs pequenos), pausa quando o separador
 * não está visível, e com prefers-reduced-motion desenha uma vez e fica parado. As cores
 * vêm de --particle / --particle-line (app/neon.css), relidas quando o tema muda.
 */
export default function FundoParticulas() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, pts = [];
    let cor = "120,140,255", corLinha = "120,140,255";
    // por tema (app/neon.css): velocidade, força dos fios e tamanho dos pontos
    let vel = 1, alfaLinha = 0.22, escala = 1, alfaPonto = 1;

    const lerCores = () => {
      const cs = getComputedStyle(document.documentElement);
      cor = cs.getPropertyValue("--particle").trim() || cor;
      corLinha = cs.getPropertyValue("--particle-line").trim() || corLinha;
      const n = (k, d) => { const v = parseFloat(cs.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
      vel = n("--particle-speed", 1); alfaLinha = n("--particle-line-alpha", 0.22);
      escala = n("--particle-size", 1); alfaPonto = n("--particle-alpha", 1);
    };

    const montar = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(18, Math.min(70, Math.round((w * h) / 24000)));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: 1 + Math.random() * 1.6, a: 0.35 + Math.random() * 0.5,
      }));
    };

    const LIGA = 130;
    const desenhar = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x, dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LIGA * LIGA) {
            ctx.strokeStyle = `rgba(${corLinha},${(1 - Math.sqrt(d2) / LIGA) * alfaLinha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${cor},${Math.min(1, p.a * alfaPonto)})`;
        ctx.shadowColor = `rgba(${cor},.9)`;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * escala, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const passo = () => {
      for (const p of pts) {
        p.x += p.vx * vel; p.y += p.vy * vel;
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      }
      desenhar();
      raf = requestAnimationFrame(passo);
    };

    const iniciar = () => { cancelAnimationFrame(raf); if (reduz || document.hidden) desenhar(); else raf = requestAnimationFrame(passo); };
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else iniciar(); };
    const onResize = () => { montar(); iniciar(); };

    lerCores(); montar(); iniciar();
    const obs = new MutationObserver(() => { lerCores(); if (reduz) desenhar(); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf); obs.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className="fundo-particulas" aria-hidden="true" />;
}
