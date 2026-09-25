"use client";
import { TERRITORIOS } from "@/lib/territorio";
import { BANDS, TIERS, CLASSIFICACOES, CLASSIFICACAO_LEGADO, PLATAFORMAS } from "@/lib/list-filters";
import BarraBusca from "./BarraBusca";

/**
 * A barra de busca do Creators Hub (set/2026): um campo só, à largura toda, e os filtros
 * por baixo — Tier, Creator's Topic, território de conteúdo, classificação, plataforma e
 * marcas com que trabalhou. Desde a rodada 2 de feedback (F3.1) o campo é a cápsula
 * partilhada (components/BarraBusca.js), a mesma de todas as páginas; Tier substituiu as
 * faixas de "Seguidores" e o sub-nicho (`sn`), que era só de URL, subiu para a barra como
 * "Creator's Topic". Sem etiquetas por cima: o dropdown fechado diz o que é, e o
 * texto do valor null de cada lista (lib/list-filters.js) é esse nome.
 *
 * O campo tem dois tempos. Escrever filtra a base por nome, @handle e categoria a cada
 * tecla (barato: é texto sobre a base já montada no servidor). Enter, ou o botão Buscar,
 * procura o mesmo texto como TEMA no conteúdo indexado dos vídeos e junta esses creators
 * atrás dos acertos de texto (lib/busca-tema.js) — é o que custa, e por isso só a pedido.
 * A linha por baixo dos filtros diz em que tempo se está e o que a busca por tema trouxe.
 *
 * Só desenha: o estado vive em CreatorsInfinite, que é quem fala com o servidor.
 */
function Pill({ value, options, onChange }) {
  return (
    <span className="filter-select-wrap">
      <select className={`filter-select${value ? " on" : ""}`} value={value || ""} aria-label={options[0]?.[1]}
        onChange={(e) => onChange(e.target.value || null)}>
        {options.map(([v, t]) => <option key={v ?? "all"} value={v ?? ""}>{t}</option>)}
      </select>
      <span className="filter-caret">▾</span>
    </span>
  );
}

export default function BuscaCreators({ q = "", onQ, onBuscar, filtering = false, tema = false, temaInfo = null, f = {}, onF, brands = [], topics = [] }) {
  const t = q.trim();
  // um valor antigo na URL (?l=rising_star) aparece como opção extra, para o dropdown não
  // fingir que não há filtro
  const classes = f.l && !CLASSIFICACOES.some(([v]) => v === f.l)
    ? [...CLASSIFICACOES, [f.l, CLASSIFICACAO_LEGADO[f.l] || f.l]]
    : CLASSIFICACOES;

  let dica = null;
  if (t && tema) {
    if (temaInfo?.erro) dica = <>Busca por tema indisponível agora ({temaInfo.erro}). A mostrar só os acertos por nome e categoria.</>;
    else if (temaInfo) dica = temaInfo.n > 0
      ? <><b>+{temaInfo.n.toLocaleString("pt-BR")}</b> creator{temaInfo.n === 1 ? "" : "s"} cujo conteúdo fala de <b>“{t}”</b>, atrás dos acertos por nome e categoria.</>
      : <>Nenhum creator a mais pelo conteúdo indexado para <b>“{t}”</b>.</>;
    else dica = <>A procurar <b>“{t}”</b> no conteúdo dos vídeos…</>;
  } else if (t) {
    dica = <>Enter ou <b>Buscar</b> procura <b>“{t}”</b> também como tema, no conteúdo dos vídeos.</>;
  }

  return (
    <section className="bc">
      <BarraBusca value={q} onChange={(v) => onQ?.(v)} onSubmit={() => onBuscar?.()} onClear={() => onQ?.("")}
        busy={filtering} ariaLabel="Buscar creators" placeholder="Digite o nome ou @ do creator…">
        <div className="bc-filters">
          <Pill value={f.tier} onChange={(tier) => onF?.({ tier })} options={TIERS} />
          {/* sub-nichos escritos pela IA (brand_history.sub_nichos) — só os que agrupam
              creators suficientes; o valor vindo de um link antigo entra como opção extra */}
          {topics.length > 0 && <Pill value={f.sn} onChange={(sn) => onF?.({ sn })} options={[[null, "Creator's Topic"], ...topics]} />}
          <Pill value={f.n} onChange={(n) => onF?.({ n })} options={[[null, "Território de conteúdo"], ...TERRITORIOS]} />
          <Pill value={f.l} onChange={(l) => onF?.({ l })} options={classes} />
          <Pill value={f.p} onChange={(p) => onF?.({ p })} options={PLATAFORMAS} />
          {/* as faixas antigas de seguidores saíram da barra (Tier ficou no lugar); só
              reaparecem quando um link antigo traz ?fw=, para o filtro não agir escondido */}
          {f.fw && <Pill value={f.fw} onChange={(fw) => onF?.({ fw })} options={BANDS} />}
          {/* as marcas beauty que a IA leu no conteúdo (brand_history) — a mesma lista da ficha */}
          {brands.length > 0 && <Pill value={f.b} onChange={(b) => onF?.({ b })} options={[[null, "Marcas com que trabalhou"], ...brands]} />}
        </div>
        <div className="bc-hint" aria-live="polite">{dica}</div>
      </BarraBusca>
    </section>
  );
}
