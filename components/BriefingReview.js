"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAMPOS, TERRITORIO_KEYWORDS, termos, camposCompat } from "@/lib/briefing-campos";
import { normalizarTemas, keywordsComTemas } from "@/lib/temas";
import { mensagemErro } from "@/lib/erro-cliente";

// SELETOR DE AUDIÊNCIA — desligado a pedido do Rui (11/09/2026), a seguir ao feedback do
// cliente que tirou "público desejado". O código fica para voltar a ligar: descomentar as
// opções, o estado `publico` e o bloco JSX no fim dos campos; o /api/campaign continua a
// ler `parsed.publico_alvo` (feminino | masculino | ambos) como multiplicador de aderência.
// Enquanto está desligado, o eixo vem só da leitura do texto pelo modelo.
// const PUBLICOS = [
//   { v: "feminino", label: "Audiência feminina", hint: "Casting priorizado por audiência feminina — o briefing geral, universo mais amplo da plataforma." },
//   { v: "masculino", label: "Audiência masculina", hint: "Casting priorizado por audiência masculina — o 2º briefing, base de creators mais restrita." },
//   { v: "ambos", label: "Sem eixo de género", hint: "Sem priorização por género — para briefings que não são de um dos dois eixos do cliente." },
// ];

/**
 * Confirmação inteligente — o que a plataforma entendeu, antes de processar a busca.
 *
 * Existe porque o match era cego dos dois lados: quem pedia não via a leitura, e a
 * leitura não dizia o que tinha inventado. Um casting custa ~1 min de cruzamento sobre
 * a base inteira; descobrir no fim que o território foi lido ao contrário custa outro.
 *
 * O que sai daqui é o perfil ESTRUTURADO (`parsed`) que o /api/campaign consome sem
 * voltar a interpretar — o mesmo caminho determinístico dos briefings fixos. Por isso
 * o que se confirma é exatamente o que corre: não há segunda leitura a divergir da
 * primeira. As complementações entram nos três sítios onde pesam — no campo, no texto
 * do briefing (que fica gravado na campanha) e nas keywords/negativos do match.
 *
 * O seletor de público (feminino/masculino/sem eixo) está DESLIGADO (ver PUBLICOS acima):
 * o eixo de género entra no fit a partir do que o modelo lê no texto (parsed.publico_alvo).
 *
 * RODADA 2 (F1.1/F1.2, set/2026): o que saiu do formulário da Busca vive aqui — o TÍTULO
 * (gerado pelo parse, editável), "O que não queremos" e os campos estruturados, agora com
 * Marca e Produto separados. E os TEMAS da expansão aparecem como chips: remover um chip
 * tira-o da busca semântica e das palavras-chave; "+ tema" acrescenta um (o rótulo vale
 * como termo). Os termos de todos os temas juntam-se às keywords (sem repetir), para o
 * pré-filtro por palavras também ganhar com eles.
 */
export default function BriefingReview({ leitura, briefing, onEditar }) {
  const router = useRouter();
  const campos = camposCompat(leitura?.campos); // leituras antigas: produto_marca → marca
  const [vals, setVals] = useState(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.k, campos[c.k]?.claro ? String(campos[c.k]?.valor || "") : ""]))
  );
  const [titulo, setTitulo] = useState(() => String(leitura?.parsed?.nome || ""));
  const negIniciais = (leitura?.parsed?.negativos ?? []).join(", ");
  const [negativos, setNegativos] = useState(negIniciais);
  const [temas, setTemas] = useState(() => normalizarTemas(leitura?.parsed?.temas));
  const [novoTema, setNovoTema] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const tirarTema = (rotulo) => setTemas((ts) => ts.filter((t) => t.rotulo !== rotulo));
  const juntarTema = () => {
    const r = novoTema.trim();
    if (!r) return;
    setTemas((ts) => normalizarTemas([...ts, { rotulo: r, termos_pt: [r.toLowerCase()] }]));
    setNovoTema("");
  };
  // seletor desligado: o eixo é o que o modelo leu (ver PUBLICOS)
  const publico = ["masculino", "feminino"].includes(leitura?.parsed?.publico_alvo) ? leitura.parsed.publico_alvo : "ambos";
  // const [publico, setPublico] = useState(() => {
  //   const p = leitura?.parsed?.publico_alvo;
  //   return p === "masculino" || p === "feminino" ? p : "ambos";
  // });

  // Marca, produto e o link de referência são opcionais: não contam como "por completar".
  const preenchido = (c) => c.opcional || !!String(vals[c.k] || "").trim();
  const faltam = CAMPOS.filter((c) => !preenchido(c));

  const confirmar = async () => {
    if (busy) return;
    setBusy(true); setErr(null);

    // o que quem pediu escreveu AGORA e não estava no texto original
    const novos = CAMPOS
      .map((c) => [c, String(vals[c.k] || "").trim()])
      .filter(([c, v]) => v && v !== String(campos[c.k]?.valor || "").trim());

    const terr = String(vals.tema_territorio || "").trim();
    const plat = String(vals.plataforma || "").trim();
    const negEditados = negativos.trim() !== negIniciais.trim();
    const parsed = {
      ...leitura.parsed,
      nome: titulo.trim() || leitura.parsed?.nome || "Busca sem título",
      publico_alvo: publico,
      campos: Object.fromEntries(CAMPOS.map((c) => [c.k, { valor: String(vals[c.k] || ""), claro: !!String(vals[c.k] || "").trim() }])),
      // o território escolhido vira também palavra-chave (é assim que o match o vê), e os
      // termos dos temas que ficaram juntam-se sem repetir
      keywords: keywordsComTemas([...(leitura.parsed?.keywords ?? []), ...(TERRITORIO_KEYWORDS[terr] ?? termos(terr))], temas),
      temas,
      negativos: negEditados ? termos(negativos) : (leitura.parsed?.negativos ?? []),
      territorio: terr || leitura.parsed?.territorio,
      plataforma: ["tiktok", "instagram", "ambas"].includes(plat) ? plat : leitura.parsed?.plataforma,
      marca_alvo: String(vals.marca || "").trim() || leitura.parsed?.marca_alvo,
      produto: String(vals.produto || "").trim() || leitura.parsed?.produto || "",
      objetivo: String(vals.objetivo || "").trim() || leitura.parsed?.objetivo,
      referencia: String(vals.referencia || "").trim() || leitura.parsed?.referencia || "",
    };

    const linhas = novos.map(([c, v]) => `${c.label}: ${v}`);
    if (negEditados && negativos.trim()) linhas.push(`O que não queremos: ${negativos.trim()}`);
    const texto = linhas.length
      ? `${briefing}\n\n— Complementado na confirmação —\n${linhas.join("\n")}`
      : briefing;

    try {
      const r = await fetch("/api/campaign", {
        method: "POST", headers: { "content-type": "application/json" },
        // busca_id: a linha de `buscas` gravada pela leitura — o /api/campaign liga-a ao
        // briefing criado (estado 'confirmado'), para sair de "Não concluída" no Histórico
        body: JSON.stringify({ briefing: texto, parsed, busca_id: leitura?.busca_id || null }),
      });
      const j = await r.json();
      if (j.id) router.push(`/creators?c=${j.id}`);
      else { setErr(mensagemErro(j, "Não foi possível gerar a busca. Tente de novo em alguns minutos.")); setBusy(false); }
    } catch { setErr(mensagemErro(null, "Sem ligação ao servidor. Verifique a internet e tente de novo.")); setBusy(false); }
  };

  return (
    <div className="briefing-box">
      <div className="bf-review-h">
        <div className="bf-review-t">Confirmação inteligente</div>
        <div className="bf-review-d">Revise o que a KOLLECT entendeu do seu briefing antes de processar a busca.</div>
      </div>

      {leitura.resumo && <div className="bf-resumo">“{leitura.resumo}”</div>}

      <label className="bf-field" style={{ marginTop: 16 }}>
        <span className="filter-label">Título da busca</span>
        <input className="brief-input" value={titulo} disabled={busy} maxLength={120}
          onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Lançamento sérum vitamina C" />
      </label>

      <div className="bf-temas">
        <div className="filter-label">Temas da busca <span className="opcional">— buscamos também pelo conteúdo dos vídeos</span></div>
        <div className="bf-temas-lista">
          {temas.map((t) => {
            const n = t.termos_pt.length + t.termos_en.length;
            const dica = [...t.termos_pt, ...t.termos_en].join(", ");
            return (
              <span key={t.rotulo} className="bf-tema" title={dica || t.rotulo}>
                {t.rotulo}{n > 1 ? <span className="bf-tema-n">{n}</span> : null}
                <button type="button" aria-label={`Remover o tema ${t.rotulo}`} onClick={() => tirarTema(t.rotulo)} disabled={busy}>×</button>
              </span>
            );
          })}
          <span className="bf-tema-add">
            <input className="brief-input" value={novoTema} disabled={busy} maxLength={60} placeholder="+ tema"
              aria-label="Acrescentar um tema"
              onChange={(e) => setNovoTema(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); juntarTema(); } }} />
            {novoTema.trim() ? <button type="button" className="chip" onClick={juntarTema} disabled={busy}>Adicionar</button> : null}
          </span>
        </div>
        {!temas.length && <div className="bf-temas-vazio">Sem temas: a busca usa só as palavras-chave do briefing.</div>}
      </div>

      {faltam.length > 0 && (
        <div className="bf-alerta">
          ⚠ Alguns itens ainda não estão claros: {faltam.map((c) => c.label).join(", ")}. Complemente abaixo antes de confirmar a busca.
        </div>
      )}

      <div className="bf-campos bf-campos-review">
        {CAMPOS.map((c) => {
          const v = vals[c.k] || "";
          const ok = preenchido(c);
          return (
            <label key={c.k} className="bf-campo">
              <span className={`bf-campo-l${ok && v.trim() ? " ok" : ""}`}>{v.trim() ? "✓" : c.opcional ? "○" : "⚠"} {c.label}{c.opcional && <span className="opcional"> (opcional)</span>}</span>
              {c.opcoes ? (
                <span className="filter-select-wrap">
                  <select className="filter-select" value={c.opcoes.some(([k]) => k === v) ? v : ""} disabled={busy}
                    onChange={(e) => setVals((s) => ({ ...s, [c.k]: e.target.value }))}>
                    <option value="">— escolher —</option>
                    {c.opcoes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <span className="filter-caret">▾</span>
                </span>
              ) : (
                <input
                  className="brief-input" value={v} disabled={busy} type={c.tipo === "url" ? "url" : "text"}
                  onChange={(e) => setVals((s) => ({ ...s, [c.k]: e.target.value }))}
                  placeholder={c.tipo === "url" ? "https://www.instagram.com/… ou https://www.tiktok.com/@…" : `Complementar ${c.label.toLowerCase()}…`}
                />
              )}
            </label>
          );
        })}

        <label className="bf-campo">
          <span className={`bf-campo-l${negativos.trim() ? " ok" : ""}`}>{negativos.trim() ? "✓" : "○"} O que não queremos <span className="opcional">(opcional)</span></span>
          <input className="brief-input" value={negativos} disabled={busy}
            onChange={(e) => setNegativos(e.target.value)}
            placeholder="Ex.: contas de salão/loja, concorrente X, termo Y — separado por vírgula" />
        </label>

        {/* Seletor de audiência — desligado (ver PUBLICOS no topo). Para voltar a ligar:
        <div className="bf-campo">
          <span className="bf-campo-l ok">✓ Público</span>
          <div className="bf-campo-publico">
            <span className="filter-select-wrap">
              <select className="filter-select" value={publico} disabled={busy} onChange={(e) => setPublico(e.target.value)}>
                {PUBLICOS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
              <span className="filter-caret">▾</span>
            </span>
            <span className="bf-campo-hint">{PUBLICOS.find((p) => p.v === publico)?.hint}</span>
          </div>
        </div>
        */}
      </div>

      <div className="briefing-actions bf-actions">
        <button className="chip" type="button" onClick={onEditar} disabled={busy}>← Editar</button>
        <span className="bf-count">{faltam.length ? `${faltam.length} por completar` : "tudo claro"}</span>
        <button className="psearch-btn" onClick={confirmar} disabled={busy}>
          {busy ? "Cruzando com o universo… ~1 min" : "Confirmar e gerar busca ›"}
        </button>
      </div>
      {err && <div className="briefing-err">{err}</div>}
    </div>
  );
}
