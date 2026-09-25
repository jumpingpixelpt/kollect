"use client";
import { useMemo, useState } from "react";
import { engRateViews } from "@/lib/engagement";
import { isPubli } from "@/lib/publi";

/**
 * CONTEÚDOS — as peças reais, com filtro por rede e ordenação.
 *
 * A miniatura não é enfeite: é a dobra que se mostra numa reunião de casting, e um cartão
 * branco com um ícone não prova nada sobre o conteúdo. Quando não há imagem, o cartão diz
 * porquê em vez de fingir uma moldura vazia — e quando a imagem existia mas morreu (as URLs
 * do Instagram e do TikTok são assinadas e expiram), o proxy devolve 404 (?sf=1) e o cartão
 * troca a moldura pela mesma frase, em vez de encher a peça com a estrela genérica.
 *
 * O selo PUBLI sai da mesma régua da saturação comercial (lib/publi.js) — a barra lá em
 * cima e os selos aqui têm de contar a mesma história.
 *
 * `tipo` (video | imagem) aparece no selo da rede quando a peça não é vídeo: as fotos e os
 * carrosséis entram na base pela legenda (é o que o brand-scan lê) e não têm views — o
 * "sem views medidas" desses cartões é isso, não é falha de importação.
 */

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const dia = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "sem data";
const ORD = {
  recentes: ["Mais recentes", (a, b) => String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? ""))],
  vistos: ["Mais vistos", (a, b) => (b.views || 0) - (a.views || 0)],
  engajamento: ["Maior engajamento", (a, b) => (engRateViews(eng(b), b.views) ?? -1) - (engRateViews(eng(a), a.views) ?? -1)],
};
const eng = (v) => (v.likes || 0) + (v.comments || 0) + (v.shares || 0) + (v.saves || 0);
const PASSO = 12;

function Miniatura({ v }) {
  const [morta, setMorta] = useState(false);
  const img = v.thumb || v.url;
  if (!img) return <span className="fc-card-semimg">sem link para a peça</span>;
  if (morta) return <span className="fc-card-semimg">miniatura expirada na origem — abre a peça ↗</span>;
  return (
    <img
      src={`/api/thumb?v=3&sf=1&${v.thumb ? `u=${encodeURIComponent(v.thumb)}&` : ""}fb=${encodeURIComponent(v.url || "")}`}
      alt={v.title || ""} loading="lazy" onError={() => setMorta(true)} />
  );
}

export default function ConteudosGrid({ videos }) {
  const [rede, setRede] = useState("");
  const [ord, setOrd] = useState("recentes");
  const [limite, setLimite] = useState(PASSO);

  const redes = useMemo(() => [...new Set((videos || []).map((v) => v.platform).filter(Boolean))], [videos]);
  const lista = useMemo(() => {
    const seen = new Set();
    return (videos || [])
      .filter((v) => !rede || v.platform === rede)
      .filter((v) => { const k = (v.url || String(v.id)).split("?")[0]; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort(ORD[ord][1]);
  }, [videos, rede, ord]);
  const imagens = useMemo(() => (videos || []).filter((v) => v.tipo && v.tipo !== "video").length, [videos]);

  if (!(videos || []).length) {
    return (
      <div className="panel">
        <h3>Conteúdos</h3>
        <div className="fc-vazio">Nenhuma peça importada para este creator — sem peças não há scorecard, nem tópicos, nem Disaster Check. Corre ↻ Atualizar dados.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="fc-diar-head">
        <h3 style={{ marginBottom: 0 }}>Conteúdos <span>· {lista.length} peça{lista.length > 1 ? "s" : ""}</span></h3>
        <div className="fc-diar-sel">
          {redes.length > 1 && (
            <select value={rede} onChange={(e) => setRede(e.target.value)} aria-label="Rede">
              <option value="">Todas as redes</option>
              {redes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <select value={ord} onChange={(e) => setOrd(e.target.value)} aria-label="Ordenação">
            {Object.entries(ORD).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
      </div>

      <div className="fc-cards">
        {lista.slice(0, limite).map((v) => {
          const taxa = engRateViews(eng(v), v.views);
          // A ficha calcula na mesma régua do scorecard antes de retirar a transcrição
          // do payload client. O fallback mantém os outros chamadores compatíveis.
          const publi = v.publi ?? isPubli(v);
          const imagem = v.tipo && v.tipo !== "video";
          return (
            <a className="fc-card" key={v.id} href={v.url || undefined} target="_blank" rel="noopener noreferrer">
              <div className="fc-card-img">
                <Miniatura v={v} />
                {publi && <span className="fc-card-publi">PUBLI</span>}
                {v.platform && <span className="fc-card-rede">{v.platform}{imagem ? ` · ${v.tipo}` : ""}</span>}
                {v.content_score != null && <span className="fc-card-ia" title="Analisado pelo deep-scan">✦ {Number(v.content_score).toFixed(1)}</span>}
              </div>
              <div className="fc-card-b">
                <div className="fc-card-d">{dia(v.posted_at)}</div>
                {v.title && <div className="fc-card-t">{v.title}</div>}
                <div className="fc-card-m">
                  <span>Views <b>{fmt(v.views)}</b></span>
                  <span>Likes <b>{fmt(v.likes)}</b></span>
                  <span>Coment. <b>{fmt(v.comments)}</b></span>
                </div>
                <div className="fc-card-e">{taxa == null ? (imagem ? "imagem · sem views na fonte" : "sem views medidas") : `${taxa}% engajamento`}</div>
              </div>
            </a>
          );
        })}
      </div>

      {lista.length > limite && (
        <button className="chip" style={{ marginTop: 16 }} onClick={() => setLimite((l) => l + PASSO)}>
          {lista.length - limite <= PASSO
            ? `Mostrar as ${lista.length - limite} restantes ▼`
            : `Mostrar mais ${PASSO} · faltam ${lista.length - limite} ▼`}
        </button>
      )}

      <div className="formula-note">
        Engajamento por peça é (likes + comentários + shares + saves) ÷ views — a mesma régua do scorecard. Shares e saves faltam com frequência na fonte e, quando faltam, não entram na conta.
        {imagens ? ` ${imagens} peça${imagens > 1 ? "s são imagens" : " é imagem"} (foto ou carrossel): entra${imagens > 1 ? "m" : ""} pela legenda e não t${imagens > 1 ? "êm" : "em"} views nem taxa.` : ""}
      </div>
    </div>
  );
}
