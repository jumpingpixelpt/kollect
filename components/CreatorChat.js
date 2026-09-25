"use client";
import { useEffect, useRef, useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";

// Chat GLOBAL do creator — balão fixo no canto inferior direito da página do creator.
// RAG sobre todo o conteúdo indexado no pgvector (perfil, score, marcas, fit, briefs,
// análises de vídeo) via /api/creator-chat. O chat por vídeo vive no VideoChat.
const SUGESTOES = [
  "Ela serve para uma campanha de skincare?",
  "Que marcas já trabalharam com ela?",
  "Qual é o vídeo com mais potencial viral?",
  "Que riscos comerciais existem?",
];

export default function CreatorChat({ creatorId, name }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const firstName = (name || "").split(" ")[0];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function pergunta(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    const history = msgs;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/creator-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_id: creatorId, question, history }),
      }).then((x) => x.json());
      setMsgs((m) => [...m, { role: "ai", text: r.answer || (r.error ? mensagemErro(r) : "Sem resposta.") }]);
    } catch {
      setMsgs((m) => [...m, { role: "ai", text: "Falha ao contactar o índice — tenta de novo." }]);
    }
    setBusy(false);
  }

  return (
    <>
      <button className="cc-fab" onClick={() => setOpen(true)} title={`Pergunte sobre ${firstName}`}>
        <span className="cc-fab-icon">✦</span>
        <span className="cc-fab-label">Pergunte sobre {firstName}</span>
      </button>
      {open && (
        <div className="vr-overlay" onClick={() => setOpen(false)}>
          <div className="vr-modal vc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vr-modal-head">
              <div className="vr-modal-title">✦ Pergunte sobre {name}</div>
              <button className="vr-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </div>
            <div className="vc-sub">Responde com base em tudo o que a plataforma coletou: perfil, score, marcas, fit, audiência e análises de vídeo.</div>

            <div className="vc-msgs">
              {msgs.length === 0 && (
                <div className="vc-empty">
                  <div className="vc-empty-t">Pergunte qualquer coisa sobre esta creator</div>
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
              {busy && <div className="vc-msg ai vc-typing">a consultar o índice…</div>}
              <div ref={endRef} />
            </div>

            <div className="vc-inputrow">
              <input
                className="vc-input" value={input} placeholder={`Pergunte sobre ${firstName}…`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") pergunta(); }}
                disabled={busy} autoFocus
              />
              <button className="vc-send" onClick={() => pergunta()} disabled={busy || !input.trim()} aria-label="Enviar">➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
