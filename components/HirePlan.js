"use client";
import { useState } from "react";

export default function HirePlan({ creatorId, recs, brands, plan, campaigns }) {
  const camps = campaigns || [];
  const [campaignId, setCampaignId] = useState(camps[0]?.id || "");
  const [roteiros, setRoteiros] = useState(null);
  const [campLabel, setCampLabel] = useState("");
  const [texto, setTexto] = useState(null);
  const [tipoAtivo, setTipoAtivo] = useState(null);
  const [st, setSt] = useState("idle");

  async function generate(tipo) {
    if (!campaignId) return;
    setSt("loading"); setRoteiros(null); setTexto(null); setTipoAtivo(tipo);
    try {
      const res = await fetch("/api/roteiros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_id: creatorId, campaign_id: campaignId, tipo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "erro");
      if (data.roteiros) setRoteiros(data.roteiros);
      if (data.texto) setTexto(data.texto);
      setCampLabel(data.campanha || ""); setSt("idle");
    } catch { setSt("error"); }
  }

  function copyAll() {
    if (!roteiros) return;
    const txt = `ROTEIROS — ${campLabel}\n\n` + roteiros.map((r, i) =>
      `ROTEIRO ${i + 1} · ${r.formato} (${r.duracao})\n${r.titulo}\nGANCHO: ${r.gancho}\n` +
      (r.beats || []).map((b) => `  [${b.t}] ${b.acao}`).join("\n") +
      `\nENTRADA DA MARCA: ${r.entrada_marca}\nCTA: ${r.cta}\nPOR QUE FUNCIONA: ${r.por_que_funciona}`
    ).join("\n\n──────────\n\n");
    navigator.clipboard?.writeText(txt);
    setSt("copied"); setTimeout(() => setSt("idle"), 1500);
  }

  return (
    <section className="hire">
      <div className="hire-grid">
        <div className="panel">
          <h3>Content Pattern Intelligence <span>— What to brief this creator for</span></h3>
          <div className="panel-desc">
            <b>O que é:</b> os padrões de conteúdo que mais funcionam pra essa creator + o pacote, o primeiro movimento e a nota de parceria — inteligência acionável, não plano genérico.
            <b> Por que usar:</b> diz exatamente como entrar com ela com a maior chance de performar.
          </div>
          {plan?.estrategia ? (
            <>
              <div className="transcript" style={{ fontStyle: "normal", marginBottom: 16 }}>{plan.estrategia}</div>
              {(plan.recs || []).map((r, i) => (
                <div className="rec" key={r.titulo}>
                  <div className="rec-n">{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <div className="rec-t">{r.titulo}</div>
                    <div className="rec-d">{r.porque}</div>
                    {r.exemplo && <div className="rec-d" style={{ color: "var(--gold-bright)", opacity: 0.85 }}>Ex.: {r.exemplo}</div>}
                  </div>
                </div>
              ))}
              <div className="forecast-grid" style={{ marginTop: 18 }}>
                <div className="forecast-cell"><div className="v" style={{ fontSize: 16 }}>{plan.modalidade}</div><div className="k">Modalidade — {plan.modalidade_porque}</div></div>
                <div className="forecast-cell"><div className="v" style={{ fontSize: 14, lineHeight: 1.4 }}>{plan.primeiro_passo}</div><div className="k">Primeiro passo</div></div>
              </div>
            </>
          ) : (
            recs.map((r, i) => (
              <div className="rec" key={r.t}>
                <div className="rec-n">{String(i + 1).padStart(2, "0")}</div>
                <div><div className="rec-t">{r.t}</div><div className="rec-d">{r.d}</div></div>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <h3>AI Activation Studio <span>· do casting à ativação</span></h3>
          <div className="panel-desc">
            <b>O que é:</b> gera os entregáveis de ativação a partir dos <b>vídeos reais do creator</b> × briefing da campanha. Gera roteiros nativos (gancho, cenas, produto, CTA), DM pitch pro creator, creator brief e usage guidelines — tudo colado no que ele já faz.
            <b> Por que usar:</b> prova que a plataforma não termina no casting — leva até o conteúdo pronto pra gravar.
          </div>
          {camps.length ? (
            <>
              <span className="filter-select-wrap" style={{ display: "block", marginBottom: 10 }}>
                <select className="filter-select" style={{ width: "100%", minWidth: 0 }} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  {camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="filter-caret">▾</span>
              </span>
              <div className="studio-btns">
                {[["scripts", "Generate 3 Scripts"], ["creator_brief", "Generate Creator Brief"], ["dm_pitch", "Generate DM Pitch"], ["client_defense", "Generate Client Defense"], ["usage_guidelines", "Generate Usage Guidelines"]].map(([t, lbl]) => (
                  <button key={t} className={`studio-btn ${tipoAtivo === t ? "active" : ""}`} onClick={() => generate(t)} disabled={st === "loading"}>{lbl}</button>
                ))}
              </div>
            </>
          ) : (
            <div className="formula-note">Crie uma campanha (com briefing) pra gerar entregáveis ancorados nela.</div>
          )}
          {st === "loading" && <div className="formula-note">Lendo os vídeos do creator e gerando no tom dele…</div>}
          {st === "error" && <div className="formula-note" style={{ color: "var(--red)" }}>Erro ao gerar — tente de novo.</div>}
          {texto && (
            <div className="studio-text">
              <pre>{texto}</pre>
              <button className="ghost-btn crm-btn" onClick={() => { navigator.clipboard?.writeText(texto); setSt("copied"); setTimeout(() => setSt("idle"), 1500); }} style={{ marginTop: 12 }}>
                {st === "copied" ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
          )}
          {roteiros && (
            <div className="roteiros">
              {roteiros.map((r, i) => (
                <div className="roteiro" key={i}>
                  <div className="roteiro-head">
                    <span className="roteiro-fmt">{r.formato}</span>
                    {r.duracao && <span className="roteiro-dur">{r.duracao}</span>}
                  </div>
                  <div className="roteiro-titulo">{String(i + 1).padStart(2, "0")} · {r.titulo}</div>
                  <div className="roteiro-lbl">Hook</div>
                  <div className="roteiro-gancho">“{r.gancho}”</div>
                  <div className="roteiro-lbl">Cena a cena</div>
                  {(r.beats || []).map((b, j) => (
                    <div className="roteiro-beat" key={j}>
                      <span className="roteiro-t">{b.t}</span>
                      <span className="roteiro-acao">{b.acao}</span>
                    </div>
                  ))}
                  {r.entrada_marca && <div className="roteiro-line"><b>Entrada da marca:</b> {r.entrada_marca}</div>}
                  {r.cta && <div className="roteiro-line"><b>CTA:</b> {r.cta}</div>}
                  {r.por_que_funciona && <div className="roteiro-why">★ {r.por_que_funciona}</div>}
                </div>
              ))}
              <button className="ghost-btn crm-btn" onClick={copyAll} style={{ marginTop: 14 }}>
                {st === "copied" ? "Copiado ✓" : "Copiar os 3 roteiros"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
