import styles from "./CreatorResultRow.module.css";
import BigNumbers from "@/components/BigNumbers";
import AvatarImg from "@/components/AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const pct = (x) => x == null ? "—" : `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const NOME_REDE = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
const ORDEM_REDE = ["instagram", "tiktok", "youtube"];

const ESTADO = {
  atingido: { icone: "✓", texto: "Atingido" },
  nao_atingido: { icone: "✕", texto: "Não atingido" },
  pendente: { icone: "?", texto: "Por confirmar" },
};

/**
 * Resultado compacto; o disclosure nativo funciona por teclado e antes da hidratação.
 *
 * Feedback rodada 2 (set/2026): o card aberto tem de ser organizado e com big numbers antes
 * da explicação. Ordem fixa do corpo: números (`numeros`, BigNumbers compacto) → justificação
 * (`justificativa` + avisos em `children`) → requisitos como checklist de uma linha cada
 * (a explicação longa fica no "ver detalhe" nativo e no title) → contas ligadas → ações.
 * Os dados e as regras não mudam; só a apresentação.
 *
 * Fase 1 da rodada 2 (21/09/2026):
 *  - F1.9/D2 (proposta): sai o número composto "X/100"; a linha mostra "N de M requisitos".
 *  - F1.5: a linha fechada é uma grelha alinhada com cabeçalho (CabecalhoResultados):
 *    Seguidores · Engagement rate (eng ÷ views) · Média de comentários · Requisitos.
 *  - F1.6: `selecao` é a caixa de seleção (components/SelecaoCreators.js), dentro do summary.
 *  - F1.7: depois dos big numbers, uma linha por rede + «Só publis» + «Todas as redes», a
 *    partir do creators.metricas_rede pré-calculado (lib/metricas-rede.js).
 *  - F1.8: `redeForte` (lib/rede-forte.js) — selos e frase, antes da tabela por rede.
 */
/** Rótulos das colunas da linha fechada — mesma grelha do summary. */
export function CabecalhoResultados({ ordem = "Ordenado por aderência ao briefing", selecao = true }) {
  return (
    <div className={`${styles.cabecalho}${selecao ? "" : ` ${styles.semSelecao}`}`} aria-hidden="true">
      {selecao && <span />}
      <span className={styles.cabCreator}>Creator <i>· {ordem}</i></span>
      <span className={styles.num}>Seguidores</span>
      <span className={styles.num}>Engagement rate</span>
      <span className={styles.num}>Média de comentários</span>
      <span className={styles.num}>Requisitos</span>
      <span />
    </div>
  );
}

/** Linhas por rede + Só publis + Todas as redes, a partir de creators.metricas_rede. */
function PorRede({ m }) {
  if (!m?.redes || !Object.keys(m.redes).length) {
    return <p className={styles.explanation}>Sem peças importadas nos últimos 90 dias para separar por rede.</p>;
  }
  const ordem = (k) => { const i = ORDEM_REDE.indexOf(k); return i < 0 ? 99 : i; };
  const redes = Object.entries(m.redes).sort(([a], [b]) => ordem(a) - ordem(b));
  const linhas = [
    ...redes.map(([rede, r]) => ({ k: rede, titulo: NOME_REDE[rede] || rede, sub: r.handles?.length ? r.handles.map((h) => `@${h}`).join(" · ") + (r.fallback ? " · últimas peças (fora dos 90 dias)" : "") : null, r })),
    m.publi ? { k: "publi", titulo: "Só publis", sub: "publicidade declarada, todas as redes", r: m.publi, cls: styles.linhaPubli } : null,
    { k: "total", titulo: "Todas as redes", sub: redes.length > 1 ? `${redes.length} redes somadas` : null, r: m.total, cls: styles.linhaTotal },
  ].filter(Boolean);
  return (
    <div className={styles.porRede} role="table" aria-label="Resultados por rede, últimos 90 dias">
      <div className={styles.porRedeCab} role="row">
        <span role="columnheader">Últimos {m.dias || 90} dias</span>
        <span role="columnheader">Seguidores</span>
        <span role="columnheader">Peças</span>
        <span role="columnheader">Views média</span>
        <span role="columnheader">Engagement rate</span>
        <span role="columnheader">Comentários média</span>
      </div>
      {linhas.map(({ k, titulo, sub, r, cls }) => (
        <div key={k} className={`${styles.porRedeLinha}${cls ? ` ${cls}` : ""}`} role="row">
          <span role="cell" className={styles.porRedeNome}><b>{titulo}</b>{sub && <i>{sub}</i>}</span>
          <span role="cell" data-label="Seguidores"><b>{k === "publi" ? "—" : fmt(r?.seguidores)}</b></span>
          <span role="cell" data-label="Peças"><b>{r?.n_pecas ?? "—"}</b></span>
          <span role="cell" data-label="Views média"><b>{fmt(r?.views_media)}</b></span>
          <span role="cell" data-label="Engagement rate"><b>{pct(r?.eng_rate)}</b></span>
          <span role="cell" data-label="Comentários média"><b>{fmt(r?.comentarios_media)}</b></span>
        </div>
      ))}
    </div>
  );
}

// `aberto` (F2.5): a linha vem expandida quando o URL traz ?aberto=<creator_id> — o «voltar»
// do squad ou do browser restaura a vista; o id e o data-creator-id servem ao scroll e ao
// components/BriefingContexto.js, que regista no URL a linha que se abre.
//
// Paginação 20 a 20 (22/09/2026): a lista do briefing (components/ListaCasting.js) desenha só
// o summary e passa o corpo em `corpo` quando o card chega (/api/campanha-card) — `onToggle`
// avisa a abertura. Sem `corpo`, o corpo é o de sempre, a partir das props do card.
// `avaliacao` no summary só precisa de { total, atingidos }.
export default function CreatorResultRow({ creator, avaliacao, tag, reference, numeros = [], colunas = {}, selecao = null, metricasRede = null, redeForte = [], justificativa, contas, acoes, aberto = false, corpo, onToggle, children }) {
  // foto durável por id (lib/avatar-src.js); morta → inicial via AvatarImg (B4, set/2026)
  const src = avatarSrc(creator.avatar_url, creator.id);
  const handle = String(creator.handle || creator.name || "Creator").replace(/^@/, "");
  const completo = avaliacao.total > 0 && avaliacao.atingidos === avaliacao.total;
  return (
    <details className={`${styles.row}${completo ? ` ${styles.complete}` : ""}`} id={`creator-${creator.id}`} data-creator-id={creator.id} open={aberto || undefined} onToggle={onToggle}>
      <summary className={`${styles.summary}${selecao ? "" : ` ${styles.semSelecao}`}`}>
        {selecao && <span className={styles.check}>{selecao}</span>}
        <AvatarImg src={src} nome={handle} size={48} className={styles.avatar} classeInicial={`${styles.avatar} ${styles.initial}`} />
        <span className={styles.identity}>
          <span className={styles.handle}>@{handle}</span>
          <span className={styles.name}>{creator.name || handle} · {creator.platform === "tiktok" ? "TikTok" : creator.platform === "instagram" ? "Instagram" : creator.platform}</span>
          <span className={styles.tags}><span>{tag}</span>{reference && <span>≈ referência</span>}</span>
        </span>
        <span className={styles.metricas}>
          <span className={styles.num} data-label="Seguidores"><b>{colunas.seguidores ?? "—"}</b></span>
          <span className={styles.num} data-label="Engagement rate" title="Engajamentos ÷ views"><b>{colunas.er ?? "—"}</b></span>
          <span className={styles.num} data-label="Média de comentários"><b>{colunas.comentarios ?? "—"}</b></span>
          <span className={`${styles.num} ${styles.req}`} data-label="Requisitos">
            {avaliacao.total ? <><b>{avaliacao.atingidos} de {avaliacao.total}</b><small>requisitos</small></> : <small>Sem requisitos definidos</small>}
          </span>
        </span>
        <span className={styles.expand}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 5 7 7-7 7" /></svg>
          <span className={styles.srOnly}>Ver requisitos e dados de @{handle}</span>
        </span>
      </summary>
      {corpo !== undefined
        ? corpo
        : <CorpoResultado handle={handle} avaliacao={avaliacao} numeros={numeros} metricasRede={metricasRede} redeForte={redeForte} justificativa={justificativa} contas={contas} acoes={acoes}>{children}</CorpoResultado>}
    </details>
  );
}

/** Corpo do card aberto: números → rede mais forte e por rede → porquê → requisitos → contas → ações. */
export function CorpoResultado({ handle, avaliacao, numeros = [], metricasRede = null, redeForte = [], justificativa, contas, acoes, children }) {
  return (
    <div className={styles.body}>
      {/* 1. big numbers primeiro */}
      <BigNumbers items={numeros} compacto ariaLabel={`Números de @${handle}`} />

      {/* 1b. rede mais forte (lib/rede-forte.js) e números por rede / publi / total */}
      {redeForte.length > 0 && (
        <div className={styles.redeForte}>
          <div className={styles.selos}>{redeForte.map((r) => <span key={r.objetivo} className={styles.selo}>{r.selo}</span>)}</div>
          {redeForte.map((r) => <p key={r.objetivo} className={styles.frase}>{r.frase}</p>)}
        </div>
      )}
      <PorRede m={metricasRede} />

      {/* 2. porquê deste nome */}
      {(justificativa || children) && (
        <div className={styles.porque}>
          {justificativa && <p className={styles.justificativa}>{justificativa}</p>}
          {children}
        </div>
      )}

      {/* 3. requisitos: uma linha por requisito; a evidência abre em "ver detalhe" */}
      <section className={styles.requirements} aria-label={`Requisitos de @${handle}`}>
        <div className={styles.sectionHead} title="Cada requisito tem o mesmo peso. Requisitos sem evidência continuam por confirmar.">
          <h3>Requisitos do briefing{avaliacao.total ? <> · <b>{avaliacao.atingidos} de {avaliacao.total}</b> atingidos</> : null}</h3>
          <span>{avaliacao.pendentes > 0 ? `${avaliacao.pendentes} por confirmar` : avaliacao.total ? "Verificação concluída" : "Sem critérios estruturados"}</span>
        </div>
        {avaliacao.requisitos.length > 0 ? (
          <ul className={styles.checklist}>
            {avaliacao.requisitos.map((req) => {
              const e = ESTADO[req.status] || ESTADO.pendente;
              return (
                <li key={req.id} className={styles[req.status]}>
                  <details className={styles.req}>
                    <summary className={styles.reqLinha} title={req.evidencia || undefined}>
                      <span className={styles.statusIcon} aria-hidden="true">{e.icone}</span>
                      <span className={styles.reqLabel}>{req.label}</span>
                      <span className={styles.estado}>{e.texto}</span>
                      {req.evidencia && <span className={styles.verDetalhe} aria-hidden="true">ver detalhe</span>}
                    </summary>
                    {req.evidencia && <p className={styles.reqDetalhe}>{req.evidencia}</p>}
                  </details>
                </li>
              );
            })}
          </ul>
        ) : <p className={styles.explanation}>Este briefing ainda não tem requisitos estruturados para calcular o indicador.</p>}
      </section>

      {/* 4. contas ligadas */}
      {contas && <p className={styles.contas}>{contas}</p>}

      {/* 5. ações */}
      {acoes && <div className={styles.acoes}>{acoes}</div>}
    </div>
  );
}

/** Enquanto o card chega: a moldura do corpo, sem números inventados. */
export function CorpoEsqueleto({ erro = null, onRepetir }) {
  return (
    <div className={styles.body} aria-busy={erro ? undefined : "true"}>
      {erro ? (
        <p className={styles.explanation} role="alert">
          {erro}{" "}
          {onRepetir && <button type="button" className="chip" onClick={onRepetir} style={{ marginLeft: 8 }}>Tentar de novo</button>}
        </p>
      ) : (
        <div className={styles.esqueleto}>
          <span className={styles.srOnly}>A carregar os dados da creator…</span>
          <div className={styles.esqNumeros}>{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
          <div className={styles.esqLinha} />
          <div className={styles.esqLinha} style={{ width: "72%" }} />
        </div>
      )}
    </div>
  );
}
