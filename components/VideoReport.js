"use client";
import { useState } from "react";

// Botão de info sobre a thumbnail de cada vídeo — abre um popup com o relatório
// multimodal completo (deep-scan v3): hook, ritmo, áudio, estrutura narrativa, texto na
// tela, estilo visual, transcrição com timestamps, pontuação e leitura KOLLECT.
//
// O botão mostrava "✦ 88" — a nota viral DO VÍDEO. Ao lado do Radar Score e do Score KOL,
// que são do CREATOR e vivem noutra escala, lia-se como se fosse mais um score global.
// Passa a ícone: a nota continua lá dentro, no relatório, onde tem contexto e legenda.
//
// E deixa de desaparecer quando não há análise. Sumir era indistinguível de estar
// partido — o operador via uns vídeos com ícone e outros sem, e nada explicava porquê.
// Agora aparece sempre, apagado, e o popup diz que a análise ainda não correu.
const BLOCK_COLOR = { Hook: "#e0a83c", Problem: "#d87d6a", Solution: "#68b168", "Social Proof": "#6a93c8", CTA: "#9a6ec4" };

export default function AnalysisButton({ video }) {
  const [open, setOpen] = useState(false);
  const a = video?.analysis || {};
  const analisado = !!a.viral_score;
  return (
    <>
      <button
        className={`vr-open${analisado ? "" : " pendente"}`}
        onClick={() => setOpen(true)}
        title={analisado ? `Relatório do vídeo · nota viral ${a.viral_score.total}/100` : "Relatório do vídeo · ainda não analisado"}
      >
        ⓘ
      </button>
      {open && (
        <div className="vr-overlay" onClick={() => setOpen(false)}>
          <div className="vr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vr-modal-head">
              <div>
                <div className="vr-modal-title">Relatório de Análise{a.category ? <span className="chip-sm">{a.category}</span> : null}</div>
                <a className="vr-url" href={video.url} target="_blank" rel="noopener noreferrer">{(video.title || video.url || "").slice(0, 90)}</a>
              </div>
              <button className="vr-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </div>
            {analisado ? <ReportBody v={video} /> : <PorAnalisar v={video} />}
          </div>
        </div>
      )}
    </>
  );
}

// Vídeo já no radar mas ainda sem passagem do deep-scan: mostra o que existe (métricas da
// Tubular) e diz o que falta, em vez de um popup vazio.
function PorAnalisar({ v }) {
  const n = (x) => x == null ? "—" : Number(x).toLocaleString("pt-BR");
  return (
    <div className="vr-cards">
      <div className="vr-card" style={{ gridColumn: "1 / -1" }}>
        <div className="vr-card-t">Análise por correr</div>
        <div className="vr-card-body">
          Este vídeo está no radar com as métricas da Tubular, mas ainda não passou pelo deep-scan —
          o passo que baixa o ficheiro e o dá ao Gemini para ler hook, ritmo, estrutura, transcrição
          e nota viral. Sem isso não há relatório nem chat sobre a peça.
          <br /><br />
          Corre <b>↻ Atualizar dados</b> no topo da ficha: o passo <i>conteudo</i> da cadeia analisa
          até 8 vídeos por execução.
        </div>
      </div>
      <div className="vr-card">
        <div className="vr-card-t">O que já se sabe</div>
        <div className="vr-card-body">
          {n(v.views)} views · {n(v.likes)} likes · {n(v.comments)} comentários · {n(v.shares)} shares
          {v.posted_at ? <><br />Publicado em {v.posted_at}</> : null}
        </div>
      </div>
    </div>
  );
}

function ReportBody({ v }) {
  const [allSegs, setAllSegs] = useState(false);
  const a = v.analysis || {};
  const dur = a.duration_seconds || a.structure?.at?.(-1)?.end_second || 0;
  const segs = a.transcript_segments || [];
  const shownSegs = allSegs ? segs : segs.slice(0, 8);
  const breakdown = a.viral_score?.breakdown || {};
  const dims = [
    ["Hook Strength", breakdown.hook_strength],
    ["Edit Quality", breakdown.edit_quality],
    ["Structure Clarity", breakdown.structure_clarity],
    ["Audio Energy", breakdown.audio_energy],
  ];
  const kollect = [
    ["Expertise", a.expertise], ["Originalidade", a.originalidade],
    ["Didática", a.didatica], ["Brand Safety", a.brand_safety],
  ].filter(([, n]) => n != null);

  return (
    <>
      <div className="vr-cards">
        {a.hook && (
          <div className="vr-card">
            <div className="vr-card-t">⚡ Hook</div>
            <div className="vr-card-body">{a.hook.description}</div>
            <div className="vr-hook-score">{a.hook.score}<span>/100</span>{a.hook.type ? <em className={`vr-badge ${String(a.hook.type).toLowerCase()}`}>{a.hook.type}</em> : null}</div>
          </div>
        )}
        {a.rhythm && (
          <div className="vr-card">
            <div className="vr-card-t">✂ Ritmo de Edição</div>
            <div className="vr-big">{Number(a.rhythm.cuts_per_second ?? 0).toFixed(1)}<span> cortes/seg</span></div>
            {a.rhythm.style ? <em className="vr-badge">{a.rhythm.style}</em> : null}
          </div>
        )}
        {a.audio && (
          <div className="vr-card">
            <div className="vr-card-t">♪ Áudio</div>
            <div className="vr-kv"><span>BPM</span><b>{a.audio.bpm_estimate ?? "—"}</b></div>
            <div className="vr-kv"><span>Voz</span><b>{a.audio.has_voice ? "Sim" : "Não"}</b></div>
            <div className="vr-kv"><span>Energia</span><em className="vr-badge">{a.audio.energy || "—"}</em></div>
            {a.audio.music_mood ? <div className="vr-mood">{a.audio.music_mood}</div> : null}
          </div>
        )}
      </div>

      {a.structure?.length > 0 && dur > 0 && (
        <div className="vr-block">
          <div className="vr-block-t">Estrutura Narrativa</div>
          <div className="vr-timeline">
            {a.structure.map((b, i) => {
              const w = Math.max(3, ((b.end_second - b.start_second) / dur) * 100);
              return <span key={i} className="vr-seg" style={{ width: `${w}%`, background: BLOCK_COLOR[b.block] || "var(--gold-deep)" }} title={`${b.block} · ${b.start_second}s–${b.end_second}s`}>{w > 8 ? b.block : ""}</span>;
            })}
          </div>
          <div className="vr-timeline-axis"><span>0s</span><span>{dur}s</span></div>
        </div>
      )}

      {a.onscreen_text?.length > 0 && (
        <div className="vr-block">
          <div className="vr-block-t">Texto na Tela</div>
          <div className="vr-ost">{a.onscreen_text.map((t, i) => <div key={i}>&ldquo;{t}&rdquo;</div>)}</div>
        </div>
      )}

      {a.visual && (
        <div className="vr-block">
          <div className="vr-block-t">Estilo Visual</div>
          <div className="vr-swatches">{(a.visual.dominant_colors || []).map((h) => <span key={h} style={{ background: h }} title={h} />)}</div>
          <div className="vr-kv"><span>Câmera</span><b>{a.visual.camera_movement || "—"}</b></div>
          <div className="vr-kv"><span>Enquadramento</span><b>{a.visual.framing || "—"}</b></div>
        </div>
      )}

      {v.transcript && (
        <div className="vr-block">
          <div className="vr-block-t">Transcrição</div>
          <div className="vr-transcript">{v.transcript}</div>
          {segs.length > 0 && (
            <>
              <div className="vr-block-t" style={{ marginTop: 14 }}>Segmentos com Tempo</div>
              <div className="vr-segs">
                {shownSegs.map((s, i) => (
                  <div key={i} className="vr-seg-row">
                    <span className="vr-time">{Number(s.start_second).toFixed(1)}s – {Number(s.end_second).toFixed(1)}s</span>
                    <span className="vr-seg-txt">&ldquo;{s.text}&rdquo;</span>
                  </div>
                ))}
              </div>
              {segs.length > 8 && (
                <button className="vr-more" onClick={() => setAllSegs(!allSegs)}>{allSegs ? "mostrar menos" : `ver todos os ${segs.length} segmentos`}</button>
              )}
            </>
          )}
        </div>
      )}

      {a.viral_score && (
        <div className="vr-block">
          <div className="vr-block-t">Pontuação</div>
          <div className="vr-score-row">
            <div className="vr-total"><b>{a.viral_score.total}</b><span>/100</span></div>
            <div className="vr-bars">
              {dims.filter(([, n]) => n != null).map(([label, n]) => (
                <div key={label} className="vr-bar-row">
                  <span className="vr-bar-l">{label}</span>
                  <span className="vr-bar"><span style={{ width: `${n}%` }} /></span>
                  <span className="vr-bar-n">{n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(kollect.length > 0 || a.temas?.length > 0 || a.marcas_citadas?.length > 0 || a.veredicto) && (
        <div className="vr-block">
          <div className="vr-block-t">Leitura KOLLECT</div>
          {kollect.length > 0 && (
            <div className="vr-chips">
              {kollect.map(([label, n]) => <span className="chip-sm" key={label}>{label} <b>{n}/10</b></span>)}
            </div>
          )}
          {a.temas?.length > 0 && (
            <div className="vr-chips">
              {a.temas.map((t) => <span className="chip-sm" key={t}>{t}</span>)}
            </div>
          )}
          {a.marcas_citadas?.length > 0 && (
            <div className="vr-marcas">
              {a.marcas_citadas.map((m, i) => <div key={i}><b>{m.marca}</b> — {m.contexto}</div>)}
            </div>
          )}
          {a.veredicto ? <div className="vr-quote">{a.veredicto}</div> : null}
        </div>
      )}
    </>
  );
}
