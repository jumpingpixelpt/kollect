"use client";

import { useState } from "react";
import { squadRequest } from "@/components/SquadExternal";
import { nomeArquivo } from "@/lib/squad-csv";

/**
 * «Gerar defesa do squad» (feedback rodada 2, F2.3 — set/2026; proposta da D8: texto na tela,
 * copiar e baixar em PDF; leitor = equipa da marca). O texto vem de /api/squad-defesa, que
 * tenta a IA e, se ela falhar, devolve o texto-modelo — a pessoa recebe sempre uma defesa.
 * A última fica guardada no squad (lists.defesa) e reaparece ao reabrir, com «Gerar de novo».
 *
 * PDF sem dependências: abre uma página de impressão com o texto e chama window.print() —
 * o «Guardar como PDF» do navegador faz o resto. O .txt fica como alternativa.
 */
const escapeHtml = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const quando = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SquadDefesa({ listId, listName, inicial = null, disabled = false }) {
  const [defesa, setDefesa] = useState(inicial);
  const [aberta, setAberta] = useState(Boolean(inicial));
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [copiada, setCopiada] = useState(false);

  async function gerar() {
    if (aGerar) return;
    if (defesa && !confirm("Gerar uma nova defesa com os membros, status e notas de agora? A defesa atual será substituída.")) return;
    setAGerar(true); setErro(""); setAviso(""); setCopiada(false);
    try {
      const r = await squadRequest("/api/squad-defesa", { list_id: listId });
      setDefesa(r.defesa); setAberta(true);
      if (r.aviso) setAviso(r.aviso);
    } catch (e) { setErro(e.message || "Não foi possível gerar a defesa agora."); }
    finally { setAGerar(false); }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(defesa.texto); setCopiada(true); setTimeout(() => setCopiada(false), 2000); }
    catch { setErro("Não foi possível copiar. Selecione o texto e copie à mão."); }
  }

  function pdf() {
    const w = window.open("", "_blank");
    if (!w) { setErro("O navegador bloqueou a janela de impressão. Permita pop-ups para este site ou use «Baixar .txt»."); return; }
    const [titulo, ...resto] = defesa.texto.split("\n");
    // títulos das secções (linhas só em maiúsculas) ganham destaque na impressão
    const corpo = resto.join("\n").split("\n").map((l) => /^[A-ZÀ-Ý0-9 —–-]{6,}$/.test(l.trim()) ? `<h2>${escapeHtml(l)}</h2>` : `<p>${escapeHtml(l) || "&nbsp;"}</p>`).join("");
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(titulo || listName)}</title>
<style>@page{margin:18mm}body{font:11pt/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;max-width:180mm;margin:0 auto}
h1{font-size:16pt;margin:0 0 4pt}h2{font-size:10pt;letter-spacing:.08em;margin:14pt 0 4pt;color:#5b3fd0}p{margin:0 0 3pt;white-space:pre-wrap}
.meta{color:#666;font-size:9pt;margin-bottom:10pt}footer{margin-top:18pt;color:#888;font-size:8.5pt}</style></head>
<body><h1>${escapeHtml(titulo || listName)}</h1><div class="meta">${escapeHtml(quando(defesa.gerada_em) ? `Gerada em ${quando(defesa.gerada_em)}` : "")}</div>${corpo}
<footer>KOLLECT by Snack · Squad · Confidencial</footer></body></html>`);
    w.document.close();
    // a janela about:blank herda a CSP desta (nonce por pedido): o print dispara daqui, não de
    // um <script> inline lá dentro
    setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 300);
  }

  const meta = defesa ? [
    defesa.fonte === "ia" ? "Redigida com IA" : "Texto-modelo (sem IA)",
    quando(defesa.gerada_em) ? `gerada em ${quando(defesa.gerada_em)}` : null,
    defesa.por ? `por ${defesa.por}` : null,
  ].filter(Boolean).join(" · ") : "";

  return <>
    <button type="button" className="squad-action" onClick={defesa && !aberta ? () => setAberta(true) : gerar} disabled={disabled || aGerar}>
      {aGerar ? "Gerando defesa…" : defesa && !aberta ? "✦ Ver defesa do squad" : "✦ Gerar defesa do squad"}
    </button>
    {erro && <p className="squad-error squad-defesa-erro" role="alert">{erro}</p>}
    {defesa && aberta && <section className="squad-defesa" aria-label="Defesa do squad">
      <div className="squad-defesa-topo">
        <div><span className="squad-eyebrow">DEFESA DO SQUAD</span><p className="squad-help" title={defesa.fonte === "ia" ? undefined : "A redação por IA não estava disponível; o texto foi montado a partir dos mesmos dados."}>{meta}</p></div>
        <div className="squad-defesa-botoes">
          <button type="button" className="squad-small-button" onClick={copiar}>{copiada ? "Copiado ✓" : "Copiar"}</button>
          <button type="button" className="squad-small-button" onClick={pdf}>Baixar PDF</button>
          <button type="button" className="squad-small-button" onClick={() => baixar(nomeArquivo(listName, "txt").replace(/^squad-/, "defesa-squad-"), defesa.texto, "text/plain;charset=utf-8")}>Baixar .txt</button>
          <button type="button" className="squad-small-button" onClick={gerar} disabled={aGerar}>{aGerar ? "Gerando…" : "Gerar de novo"}</button>
          <button type="button" className="squad-small-button" onClick={() => setAberta(false)} aria-label="Fechar a defesa">Fechar</button>
        </div>
      </div>
      {aviso && <p className="squad-help" role="status">{aviso}</p>}
      <textarea readOnly value={defesa.texto} className="squad-defesa-texto" aria-label="Texto da defesa do squad" />
    </section>}
  </>;
}
