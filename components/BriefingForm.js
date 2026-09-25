"use client";
import { useEffect, useRef, useState } from "react";
import { LIMITE_BRIEFING } from "@/lib/briefing-campos";
import BriefingReview from "./BriefingReview";
import { mensagemErro } from "@/lib/erro-cliente";

const SEM_REDE = "Sem ligação ao servidor. Verifique a internet e tente de novo.";

/**
 * Formulário de busca — a barra única (o "grande Google": texto, anexo e contador) e, logo
 * por baixo, dois campos curtos: **Marca** e **Produto**, separados e opcionais (feedback
 * rodada 2, F1.1 — proposta da D1). O parse deriva os atributos de cada um para as
 * palavras-chave e os temas da expansão.
 *
 * Saíram daqui (o X roxo da captura do cliente) e vivem agora na confirmação
 * (BriefingReview): o título — gerado pelo parse, editável lá —, "O que não queremos" e os
 * campos de "Estruturar briefing" (objetivo, território, plataforma, referência). Uma busca
 * antiga retomada do Histórico ainda traz título, negativos e extras gravados: seguem para
 * o parse tal como estavam, sem campo à vista.
 *
 * ANEXO (pontos 4 e 5): o documento inteiro vai à IA sintetizar, e o limite de 3.000
 * caracteres aplica-se ao briefing que sai, não ao ficheiro que entra. Um briefing de 12
 * páginas cortado aos 3.000 não era o briefing. Só quando o texto cabe é que entra tal
 * como está, sem passar pelo modelo.
 *
 * O botão não gera casting: gera LEITURA (/api/briefing-parse, segundos). Gerar é o
 * passo seguinte, e só depois de alguém confirmar o que a plataforma entendeu.
 *
 * HISTÓRICO (feedback rodada 2, bug 2): cada leitura fica gravada em `buscas`; o id vem na
 * resposta e segue para a confirmação. `/?retomar=<id>` reabre uma busca não concluída com
 * o texto e os campos preenchidos (GET /api/buscas?id=), e a releitura actualiza a mesma
 * linha em vez de criar outra. Erros só pela mensagem amigável (bug 1, lib/erro-cliente.js).
 */
export default function BriefingForm() {
  const [marca, setMarca] = useState("");
  const [produto, setProduto] = useState("");
  const [txt, setTxt] = useState("");
  // só de buscas antigas retomadas (formulário anterior à rodada 2) — sem campo à vista
  const [titulo, setTitulo] = useState("");
  const [negativos, setNegativos] = useState("");
  const [extras, setExtras] = useState({});
  const [busy, setBusy] = useState(false);
  const [fase, setFase] = useState(null); // "anexo" | "leitura"
  const [err, setErr] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [leitura, setLeitura] = useState(null);
  const [buscaId, setBuscaId] = useState(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  // "Retomar" do Histórico: lê o ?retomar= da URL (sem useSearchParams, que obrigaria a
  // página a um Suspense) e preenche o formulário com o que ficou gravado.
  useEffect(() => {
    let id = null;
    try { id = new URLSearchParams(window.location.search).get("retomar"); } catch { /* sem URL */ }
    if (!id) return;
    let vivo = true;
    fetch(`/api/buscas?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return;
        if (!j?.busca) { setErr(mensagemErro(j, "Não foi possível reabrir esta busca.")); return; }
        const b = j.busca, c = b.campos || {};
        setTxt(String(b.texto || ""));
        setTitulo(String(c.titulo || ""));
        setMarca(String(c.marca || ""));
        setProduto(String(c.produto || ""));
        setNegativos(String(c.negativos || ""));
        setExtras(c.extras && typeof c.extras === "object" ? c.extras : {});
        if (b.estado !== "confirmado") setBuscaId(b.id);
        setAviso("Busca retomada — revise o texto e continue.");
      })
      .catch(() => { if (vivo) setErr(mensagemErro(null, "Não foi possível reabrir esta busca.")); });
    return () => { vivo = false; };
  }, []);

  // A caixa cresce com o texto até ao limite (ponto 5.2): quem revê um briefing de 3.000
  // caracteres tem de o ver inteiro, não por uma frincha com scroll.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(26, ta.scrollHeight)}px`;
  }, [txt]);

  // Texto anexado: cabe → entra tal como está; não cabe → a IA sintetiza para dentro do limite.
  const receber = async (texto, origem) => {
    const limpo = String(texto || "").trim();
    if (!limpo) return;
    const todo = txt ? `${txt}\n\n${limpo}` : limpo;
    if (todo.length <= LIMITE_BRIEFING) { setTxt(todo); setAviso(null); return; }

    setBusy(true); setFase("anexo"); setErr(null); setAviso(null);
    try {
      const r = await fetch("/api/briefing-sintese", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto: todo, titulo, marca: [marca, produto].filter((x) => x.trim()).join(" — ") }),
      });
      const j = await r.json();
      if (j.error) { setErr(`${origem}: ${mensagemErro(j)}`); return; }
      setTxt(String(j.briefing || "").slice(0, LIMITE_BRIEFING));
      setAviso(`${origem}: sintetizado em briefing — revise o texto antes de continuar.`);
    } catch { setErr(`${origem}: ${SEM_REDE}`); }
    finally { setBusy(false); setFase(null); }
  };

  const anexar = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // permite reanexar o mesmo ficheiro
    if (!f) return;
    const pdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    if (!pdf && !/\.(txt|md|markdown|csv|rtf)$/i.test(f.name)) {
      setErr(`"${f.name}": leio PDF, .txt, .md, .csv e .rtf — para DOCX, cole o texto na caixa.`);
      return;
    }
    if (!pdf) { await receber(await f.text(), f.name); return; }

    // PDF: o texto é extraído no servidor (/api/briefing-texto, unpdf) — sem IA, em segundos
    if (f.size > 4 * 1024 * 1024) {
      setErr(`"${f.name}" tem ${(f.size / 1048576).toFixed(1)} MB — o limite é 4 MB. Exporte só as páginas do briefing.`);
      return;
    }
    setBusy(true); setFase("anexo"); setErr(null);
    let texto = null, paginas = 0;
    try {
      const r = await fetch("/api/briefing-texto", { method: "POST", headers: { "content-type": "application/pdf" }, body: f });
      const j = await r.json();
      if (j.error) { setErr(`"${f.name}": ${mensagemErro(j)}`); return; }
      if (j.vazio) { setErr(`"${f.name}": o PDF não tem camada de texto (digitalizado?) — cole o texto na caixa.`); return; }
      texto = j.texto; paginas = j.paginas;
    } catch { setErr(`"${f.name}": ${SEM_REDE}`); return; }
    finally { setBusy(false); setFase(null); }
    await receber(texto, `${f.name} (${paginas} página${paginas === 1 ? "" : "s"})`);
  };

  const revisar = async () => {
    if (!txt.trim() || busy) return;
    setBusy(true); setFase("leitura"); setErr(null);
    try {
      const r = await fetch("/api/briefing-parse", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefing: txt, marca, produto, titulo, negativos, extras, busca_id: buscaId }),
      });
      const j = await r.json();
      // a busca fica gravada mesmo quando a leitura falha: guardar o id faz a nova
      // tentativa actualizar essa linha em vez de criar outra
      if (j.busca_id) setBuscaId(j.busca_id);
      if (j.error) { setErr(mensagemErro(j)); return; }
      setLeitura(j);
    } catch { setErr(SEM_REDE); }
    finally { setBusy(false); setFase(null); }
  };

  if (leitura) {
    return (
      <BriefingReview
        leitura={leitura}
        briefing={txt}
        onEditar={() => setLeitura(null)}
      />
    );
  }

  const estado = busy ? (fase === "anexo" ? "Lendo o anexo…" : "Lendo o briefing…") : `${txt.length}/${LIMITE_BRIEFING}`;

  return (
    <div className="briefing-box match-form">
      <div className="match-search">
        <div className="match-input-shell">
          <span aria-hidden="true">⌕</span>
          <textarea ref={taRef} className="briefing-ta" rows={1} maxLength={LIMITE_BRIEFING}
            aria-label="Cole o briefing ou escreva o que você quer encontrar"
            placeholder="Cole o briefing ou escreva o que você quer encontrar"
            value={txt} onChange={(e) => setTxt(e.target.value)} disabled={busy} />
          <input ref={fileRef} type="file" accept=".pdf,application/pdf,.txt,.md,.markdown,.csv,.rtf,text/plain,text/markdown" onChange={anexar} style={{ display: "none" }} />
          <button className="match-attach" type="button" aria-label="Anexar briefing" title="Anexar briefing" onClick={() => fileRef.current?.click()} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-8 8a1.5 1.5 0 0 1-2-2l7-7" /></svg>
          </button>
          <button className="match-submit" type="button" onClick={revisar} disabled={busy || !txt.trim()} aria-label={busy ? "Lendo o briefing" : "Revisar briefing"} title="Revisar briefing">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
      <p className="match-support">Você nos guia na primeira análise; depois, conte com nossa inteligência para otimizar toda a sua busca.</p>

      <div className="match-options">
        <div className="bf-row2">
          <label className="bf-field">
            <span className="filter-label">Marca <span className="opcional">(opcional)</span></span>
            <input className="brief-input" value={marca} onChange={(e) => setMarca(e.target.value)}
              placeholder="Ex.: Elsève" disabled={busy} maxLength={80} />
          </label>
          <label className="bf-field">
            <span className="filter-label">Produto <span className="opcional">(opcional)</span></span>
            <input className="brief-input" value={produto} onChange={(e) => setProduto(e.target.value)}
              placeholder="Ex.: Glycolic Gloss" disabled={busy} maxLength={120} />
          </label>
        </div>
      </div>

      <div className="bf-count">{estado}</div>
      {aviso && !err && <div className="bf-aviso">{aviso}</div>}
      {err && <div className="briefing-err">{err}</div>}
    </div>
  );
}
