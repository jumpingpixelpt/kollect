"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Promoção em lote a partir de /descobertas — o condutor da triagem do dia.
 *
 * CONDUZIDO PELO BROWSER, elo a elo, como a cadeia da descoberta e pela mesma razão: a
 * Vercel corta auto-invocações no servidor à 5ª, e um drain server-side morria em silêncio.
 * Cada volta promove 1 prospect (a promoção arrasta a cadeia de enriquecimento inteira,
 * ~3-4 min) e o progresso fica à vista, nome a nome. Fechar o separador pausa; voltar a
 * carregar continua — a fila vive na base, não aqui.
 *
 * Antes de promover, resolve os handles em falta (a Tubular não dá o @; o resolve-handles
 * tira-o do URL do post via Apify) — também em voltas conduzidas daqui, n=60 por chamada.
 */
const ALVOS = [10, 25, 50, 100];

export default function PromoteRunner() {
  const router = useRouter();
  const [alvo, setAlvo] = useState(50);
  const [busy, setBusy] = useState(false);
  const [fase, setFase] = useState(null); // "handles" | "promo"
  const [log, setLog] = useState([]);     // [{handle, classe, erro, mini_score}]
  const [resumo, setResumo] = useState(null);
  const [err, setErr] = useState(null);
  const parar = useRef(false);

  const correr = async () => {
    setBusy(true); setErr(null); setLog([]); setResumo(null); parar.current = false;
    try {
      // ── fase 1: handles em falta (barato — ~$0,002/perfil no Apify) ──
      setFase("handles");
      for (let i = 0; i < 4 && !parar.current; i++) {
        const s = await (await fetch("/api/promote-batch?minscore=75&dias=1&check=1", { cache: "no-store" })).json();
        if (!s.sem_handle) break;
        const r = await (await fetch("/api/resolve-handles?n=200", { method: "POST", cache: "no-store" })).json();
        if (r.error || r.fatal) { setErr(r.error || r.fatal); return; }
        if (!r.resolvidos) break; // Apify não conseguiu mais nenhum — segue com o que há
      }

      // ── fase 2: promover, 1 por volta, até ao alvo ou à fila vazia ──
      setFase("promo");
      let feitos = 0;
      while (feitos < alvo && !parar.current) {
        const j = await (await fetch("/api/promote-batch?minscore=75&dias=1&n=1", { method: "POST", cache: "no-store" })).json();
        if (j.error || j.fatal) { setErr(j.error || j.fatal); break; }
        if (!j.promovidos?.length) { setResumo(j.msg || "fila vazia"); break; }
        for (const p of j.promovidos) {
          if (!p.erro) feitos++;
          setLog((l) => [{ ...p }, ...l].slice(0, 120));
        }
        if (!j.continua) { setResumo("fila esgotada"); break; }
      }
      if (feitos >= alvo) setResumo(`alvo de ${alvo} atingido`);
      router.refresh();
    } catch (e) {
      setErr(String(e).slice(0, 200));
    } finally { setBusy(false); setFase(null); }
  };

  return (
    <div className="disc-runner" style={{ marginTop: 10 }}>
      <div className="disc-runner-box">
        <div className="disc-runner-row">
          <label className="filter-group">
            <span className="filter-label">Promover (score ≥ 75, hoje)</span>
            <select className="filter-select" value={alvo} disabled={busy} onChange={(e) => setAlvo(Number(e.target.value))}>
              {ALVOS.map((a) => <option key={a} value={a}>{a} creators</option>)}
            </select>
          </label>
          <button type="button" className="gold-btn" disabled={busy} onClick={correr}>
            {busy ? (fase === "handles" ? "A resolver @…" : `A promover… (${log.filter((l) => !l.erro).length}/${alvo})`) : "Promover melhores de hoje"}
          </button>
          {busy && <button type="button" className="chip" onClick={() => { parar.current = true; }}>Parar depois deste</button>}
        </div>
        <div className="disc-runner-hint">
          Resolve os @ em falta e depois promove 1 de cada vez, por ordem de score — cada um corre a
          cadeia completa (perfil, vídeos, análise, marcas, screening, audiência: 1 crédito IC por
          creator), ~3–4 min por nome. Mantém o separador aberto; fechar pausa e voltar a carregar
          continua de onde ficou.
        </div>
        {err && <div className="disc-runner-err">{err}</div>}
        {(log.length > 0 || resumo) && (
          <div className="disc-runner-res">
            {resumo && <><b>{resumo}</b> · {log.filter((l) => !l.erro).length} promovida(s), {log.filter((l) => l.erro).length} falha(s)<br /></>}
            {log.slice(0, 30).map((p, i) => (
              <div key={i} style={{ opacity: p.erro ? 0.7 : 1 }}>
                @{p.handle} · {p.platform} · score {p.mini_score != null ? Number(p.mini_score).toFixed(0) : "—"} —{" "}
                {p.erro ? <span style={{ color: "var(--red)" }}>{String(p.erro).slice(0, 90)}</span> : <b>{p.classe || "promovida ✓"}</b>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
