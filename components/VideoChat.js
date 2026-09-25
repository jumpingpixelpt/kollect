"use client";
import { useEffect, useRef, useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";

// Balão de chat sobre a thumbnail de cada vídeo analisado — abre um popup "Pergunte
// sobre este vídeo" (processo tokforge chat-with-video): sugestões, histórico e
// respostas do Gemini com o contexto da análise multimodal + transcrição.
const SUGESTOES = [
  "O que torna esse hook tão forte?",
  "Por que este vídeo tem potencial viral?",
  "Que técnicas de engajamento são usadas?",
  "Gerar um roteiro usando essa estrutura",
];

export default function ChatButton({ video }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  // Também deixa de desaparecer sem análise: o par de ícones aparece sempre que há vídeo.
  // O /api/video-chat recusa com "vídeo sem análise", portanto aqui explica-se antes de
  // deixar perguntar, em vez de mandar o operador contra um erro cru.
  const analisado = !!video?.analysis?.viral_score;

  async function pergunta(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/video-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_id: video.id, question, history }),
      }).then((x) => x.json());
      setMsgs((m) => [...m, { role: "ai", text: r.answer || (r.error ? mensagemErro(r) : "Sem resposta.") }]);
    } catch {
      setMsgs((m) => [...m, { role: "ai", text: "Falha ao contactar a análise — tenta de novo." }]);
    }
    setBusy(false);
  }

  return (
    <>
      <button
        className={`vc-open${analisado ? "" : " pendente"}`}
        onClick={() => setOpen(true)}
        title={analisado ? "Pergunte sobre este vídeo" : "Chat do vídeo · ainda não analisado"}
      >💬</button>
      {open && (
        <div className="vr-overlay" onClick={() => setOpen(false)}>
          <div className="vr-modal vc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vr-modal-head">
              <div className="vr-modal-title">💬 Pergunte sobre este vídeo</div>
              <button className="vr-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </div>
            <div className="vc-sub">{(video.title || "").slice(0, 90)}</div>

            <div className="vc-msgs">
              {!analisado && (
                <div className="vc-empty">
                  <div className="vc-empty-t">Este vídeo ainda não foi analisado</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55, maxWidth: 420 }}>
                    O chat responde a partir da análise multimodal e da transcrição, e nenhuma
                    das duas existe ainda para esta peça. Corre <b>↻ Atualizar dados</b> no topo
                    da ficha — o passo <i>conteudo</i> da cadeia trata disso.
                  </div>
                </div>
              )}
              {analisado && msgs.length === 0 && (
                <div className="vc-empty">
                  <div className="vc-empty-t">Pergunte qualquer coisa sobre este vídeo</div>
                  <div className="vc-chips">
                    {SUGESTOES.map((s) => (
                      <button key={s} className="vc-chip" onClick={() => pergunta(s)} disabled={busy}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`vc-msg ${m.role === "user" ? "user" : "ai"}`}>{m.text}</div>
              ))}
              {busy && <div className="vc-msg ai vc-typing">a analisar…</div>}
              <div ref={endRef} />
            </div>

            <div className="vc-inputrow">
              <input
                className="vc-input" value={input}
                placeholder={analisado ? "Pergunte sobre este vídeo…" : "Disponível depois da análise"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") pergunta(); }}
                disabled={busy || !analisado} autoFocus={analisado}
              />
              <button className="vc-send" onClick={() => pergunta()} disabled={busy || !analisado || !input.trim()} aria-label="Enviar">➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
