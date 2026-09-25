"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CreatorCard from "./CreatorCard";
import AvatarImg from "./AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";
import { TIER_LABEL, tierDe, tierFollowers } from "@/lib/list-filters";
import styles from "./RadarListing.module.css";

// Pool = Hidden Gem + Brand Safe Performer + elegível sem classe (decisão do Rui, 11/09/2026)
const TAG_DE = { kol: "KOL", rising_star: "Rising Star", hidden_gem: "Pool", brand_safe_performer: "Pool", elegivel: "Pool" };

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k" : String(Math.round(n));
// taxa de engajamento = engajamentos ÷ views (lib/engagement.js), em %; null quando a rede
// ainda não foi medida — nunca se inventa a partir dos seguidores (a mesma do card)
const pct = (x) => (x == null ? "—" : `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const Seta = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
  </svg>
);
const PLAT = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };
const platLabel = (p) => PLAT[p] || (p ? p[0].toUpperCase() + p.slice(1) : "—");

/**
 * A busca e os filtros vivem na barra (components/BuscaCreators.js) e a ordenação por
 * coluna é controlada de fora — tudo estado de CreatorsInfinite, que o manda ao servidor.
 * Aqui só se desenha a lista, a seleção em lote e o que vier. Enquanto a busca foi estado
 * local, filtrava apenas a fatia já carregada — 48 de 1.765 — e a lista mentia sem dizer
 * que mentia. `creators` chega já filtrado e ordenado; `q` e `temFiltros` só servem
 * ao estado vazio, para dizer de quê está vazio.
 */
export default function RadarListing({
  creators = [], lists = [], campaigns = [], tags = [],
  q = "", temFiltros = false, sort = null, onSort,
  filtering = false, onLimpar, onMutate = null,
  // apagar creators é acto de Gestão (só admin; a rota /api/creator-delete também exige) —
  // o botão só aparece a quem pode, em vez de aparecer e falhar
  podeApagar = false,
}) {
  const router = useRouter();
  const [view, setView] = useState("list");

  // seleção múltipla (adicionar a lista / campanha / tag) — direto no radar
  const [sel, setSel] = useState({});
  const [panel, setPanel] = useState(null); // "list" | "campaign" | "tag" | "apagar" | null
  // inventário do que o apagar vai destruir, vindo do ?dry da rota. É estado próprio e não
  // uma mensagem porque a confirmação precisa dos números à vista, não de um "tem certeza?".
  const [inv, setInv] = useState(null);
  const [listChoice, setListChoice] = useState("");
  const [campChoice, setCampChoice] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // toggle persistente durante a sessão
  useEffect(() => {
    try { const v = sessionStorage.getItem("radar_view"); if (v) setView(v); } catch {}
  }, []);
  const pickView = (v) => { setView(v); try { sessionStorage.setItem("radar_view", v); } catch {} };

  // o servidor já entregou o recorte pronto — pintar é só isto
  const list = creators;
  const rows = creators;
  const temFiltro = !!(q.trim() || temFiltros);

  // ── ordenação por coluna (clique no título: desc → asc → sem ordenação) ──
  const clickSort = (k) => onSort?.((!sort || sort.key !== k) ? { key: k, dir: "desc" } : sort.dir === "desc" ? { key: k, dir: "asc" } : null);
  const Th = ({ k, children }) => k ? (
    <th onClick={() => clickSort(k)} className={"rl-th-sort" + (sort?.key === k ? " on" : "")} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} title="Ordenar por esta coluna">
      {children}<span style={{ marginLeft: 3, opacity: sort?.key === k ? 1 : 0.35 }}>{sort?.key === k ? (sort.dir === "desc" ? "↓" : "↑") : "⇅"}</span>
    </th>
  ) : <th>{children}</th>;

  // ── seleção ──
  // Guarda o creator, não um booleano: com a busca e os filtros no servidor, quem
  // estava marcada some da lista quando o recorte muda, e uma seleção derivada de
  // `creators` levaria consigo as marcações. Assim marca-se em vários recortes
  // seguidos e o lote sai inteiro.
  const toggleSel = (c) => setSel((s) => { const n = { ...s }; if (n[c.id]) delete n[c.id]; else n[c.id] = c; return n; });
  const selectedCreators = Object.values(sel);
  const clearSel = () => { setSel({}); setPanel(null); setMsg(null); };
  // "Selecionar todos os visíveis": os que já desceram para o browser, não o recorte inteiro
  // (que pode ter 2 mil). Desmarcar tira só os visíveis — o que foi marcado noutro recorte fica.
  const nVisSel = creators.filter((c) => sel[c.id]).length;
  const todosVisiveis = creators.length > 0 && nVisSel === creators.length;
  const toggleVisiveis = () => setSel((s) => {
    const n2 = { ...s };
    for (const c of creators) { if (todosVisiveis) delete n2[c.id]; else n2[c.id] = c; }
    return n2;
  });
  // `match_score` é o fit a um briefing de CAMPANHA — quando não há campanha, não há match.
  // Escrevia-se aqui `c.total`, o Radar Score, e a lista mostrava-o com o rótulo "match": o
  // @oerickgabriel entrou numa lista com 41,1 e no mesmo dia o Radar dele passou a 19,7,
  // porque o valor é gravado uma vez e nunca recalculado. Duas réguas erradas ao mesmo tempo
  // — a do funil a fazer-se passar por match, e congelada. A lista passa a ler o Score KOL ao
  // vivo quando não há campanha (ver app/(app)/listas/page.js).
  const itemsOf = () => selectedCreators.map((c) => ({ creator_id: c.id, prospect_id: null, match_score: c.camp?.match ?? null }));
  const targetsOf = () => selectedCreators.map((c) => ({ creator_id: c.id }));

  async function addToList() {
    if (!selectedCreators.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      let r;
      if (listChoice === "__new__" || (!listChoice && !lists.length)) {
        const name = window.prompt("Nome da nova squad list:", `Squad list ${new Date().toLocaleDateString("pt-BR")}`);
        if (!name) { setBusy(false); return; }
        r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, items: itemsOf() }) });
      } else if (listChoice) {
        r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_items", list_id: listChoice, items: itemsOf() }) });
      } else { setMsg("Escolha uma squad list."); setBusy(false); return; }
      const j = await r.json();
      setMsg(j.error ? `Erro: ${j.error}` : `${selectedCreators.length} adicionada(s) à squad list ✓`);
      if (!j.error) setPanel(null);
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  async function addToCampaign() {
    if (!selectedCreators.length || busy || !campChoice) { if (!campChoice) setMsg("Escolha uma campanha."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/campaign-add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign_id: campChoice, items: itemsOf() }) });
      const j = await r.json();
      setMsg(j.error ? `Erro: ${j.error}` : `${j.added ?? 0} adicionada(s) ao casting ✓`);
      if (!j.error) setPanel(null);
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  async function applyTag() {
    const name = tagText.trim();
    if (!selectedCreators.length || busy || !name) { if (!name) setMsg("Digite uma tag."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", name, targets: targetsOf() }) });
      const j = await r.json();
      setMsg(j.error ? `Erro: ${j.error}` : `Tag "${j.tag?.name || name}" aplicada a ${j.applied ?? 0} ✓`);
      if (!j.error) { setTagText(""); setPanel(null); router.refresh(); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  // APAGAR EM DOIS PASSOS, e o primeiro não destrói nada.
  //
  // As dez tabelas que apontam para `creators` estão em ON DELETE CASCADE, portanto isto apaga
  // o dossiê inteiro — incluindo o que foi pago ao Gemini, ao Claude e ao influencers.club, e o
  // histórico de medições, que nem pagando volta. Um confirm() genérico não dá ao operador
  // nada com que decidir; o primeiro passo pergunta à base o que existe e mostra-o.
  async function pedirApagar() {
    if (!selectedCreators.length || busy) return;
    setBusy(true); setMsg(null); setInv(null);
    try {
      const r = await fetch("/api/creator-delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedCreators.map((c) => c.id), dry: true }),
      });
      const j = await r.json();
      if (j.error || j.fatal) setMsg(`Erro: ${j.error || j.fatal}`);
      else { setInv(j); setPanel("apagar"); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  async function apagar() {
    if (!selectedCreators.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/creator-delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedCreators.map((c) => c.id) }),
      });
      const j = await r.json();
      if (j.error || j.fatal) setMsg(`Erro: ${j.error || j.fatal}`);
      else {
        setMsg(`${j.apagados} apagada(s) ✓${j.prospects_marcados ? ` · ${j.prospects_marcados} prospect(s) devolvido(s) à decisão` : ""}`);
        setInv(null); setPanel(null); setSel({});
        // recarregar a lista SALTANDO o cache de processo do servidor: o router.refresh()
        // sozinho repintava a mesma cópia em memória e as apagadas continuavam no ecrã
        onMutate ? await onMutate() : router.refresh();
      }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  return (
    <>
      {/* Linha da lista: "selecionar todos os visíveis" à esquerda e vista à
          direita. A busca, a faixa e o tipo subiram para a barra (components/BuscaCreators.js). */}
      <div className="rl-row">
        <label className="rl-selall" title={creators.length ? "Marca ou desmarca todos os creators já carregados" : undefined}>
          <input type="checkbox" checked={todosVisiveis} disabled={!creators.length}
            ref={(el) => { if (el) el.indeterminate = nVisSel > 0 && !todosVisiveis; }}
            onChange={toggleVisiveis} />
          Selecionar todos os visíveis
        </label>
        <div className="rl-toggle" role="group" aria-label="Vista" style={{ marginLeft: "auto" }}>
          <button className={view === "card" ? "on" : ""} onClick={() => pickView("card")} title="Cards" aria-label="Cards">▦</button>
          <button className={view === "list" ? "on" : ""} onClick={() => pickView("list")} title="Lista" aria-label="Lista">☰</button>
        </div>
      </div>

      {selectedCreators.length > 0 && (
        <div className="evolve-bar" style={{ flexWrap: "wrap", gap: 10 }}>
          <span className="evolve-count">{selectedCreators.length} selecionada{selectedCreators.length > 1 ? "s" : ""}</span>
          <button className="chip" onClick={() => setPanel(panel === "list" ? null : "list")} disabled={busy}>+ Squad List</button>
          <button className="chip" onClick={() => setPanel(panel === "campaign" ? null : "campaign")} disabled={busy}>+ Campanha</button>
          <button className="chip" onClick={() => setPanel(panel === "tag" ? null : "tag")} disabled={busy}>+ Tag</button>
          {/* destrutivo, por isso é o único em vermelho e o único que não age ao primeiro
              clique — abre o inventário do que vai desaparecer; só admin (Gestão) */}
          {podeApagar && <button className="chip" onClick={() => (panel === "apagar" ? (setPanel(null), setInv(null)) : pedirApagar())}
            disabled={busy} style={{ borderColor: "rgba(220,90,90,.5)", color: "#e89090" }}>
            {busy && panel !== "apagar" ? "A contar…" : "Apagar"}
          </button>}
          {!busy && <button className="psearch-clear" onClick={clearSel}>Limpar seleção</button>}

          {panel === "list" && (
            <div className="sel-panel">
              <select className="filter-select" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
                <option value="">Escolher squad list…</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                <option value="__new__">+ Nova squad list…</option>
              </select>
              <button className="gold-btn" onClick={addToList} disabled={busy}>Adicionar à squad list</button>
            </div>
          )}
          {panel === "campaign" && (
            <div className="sel-panel">
              <select className="filter-select" value={campChoice} onChange={(e) => setCampChoice(e.target.value)}>
                <option value="">Escolher campanha…</option>
                {campaigns.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
              </select>
              <button className="gold-btn" onClick={addToCampaign} disabled={busy}>Adicionar ao casting</button>
            </div>
          )}
          {panel === "tag" && (
            <div className="sel-panel">
              <input className="rl-search" list="radar-tag-options" placeholder="Tag (nova ou existente)…" value={tagText}
                onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyTag(); }} style={{ minWidth: 200 }} />
              <datalist id="radar-tag-options">{tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              <button className="gold-btn" onClick={applyTag} disabled={busy}>Aplicar tag</button>
            </div>
          )}
          {panel === "apagar" && inv && (
            <div className="sel-panel" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, borderColor: "rgba(220,90,90,.45)" }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Apagar <b>{inv.creators?.length}</b> creator{inv.creators?.length === 1 ? "" : "s"}
                {inv.creators?.length <= 4 ? ` (${inv.creators.map((c) => "@" + c.handle).join(", ")})` : ""} remove em cascata:
                <br />
                {Object.values(inv.inventario || {})
                  .filter((x) => x.linhas > 0)
                  .map((x) => `${x.linhas} ${x.rotulo}`)
                  .join(" · ") || "nada além da própria linha"}
                {inv.inventario?.videos?.analisados > 0 && (
                  <><br /><span style={{ color: "#e8b06a" }}>
                    {inv.inventario.videos.analisados} vídeo{inv.inventario.videos.analisados === 1 ? "" : "s"} com
                    análise já paga ao Gemini — reimportar volta a cobrar.
                  </span></>
                )}
                {inv.inventario?.snapshots?.linhas > 0 && (
                  <><br /><span style={{ color: "var(--red)" }}>O histórico de medições não se recupera.</span></>
                )}
                {inv.prospects_a_reabrir > 0 && (
                  <><br />{inv.prospects_a_reabrir} prospect{inv.prospects_a_reabrir === 1 ? "" : "s"} de origem
                  volta{inv.prospects_a_reabrir === 1 ? "" : "m"} a ficar por decidir, fora da fila de promoção.</>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="chip" onClick={() => { setPanel(null); setInv(null); }} disabled={busy}>Cancelar</button>
                <button className="gold-btn" onClick={apagar} disabled={busy}
                  style={{ background: "linear-gradient(135deg,#8d3b34,#c4574c)", color: "#fff" }}>
                  {busy ? "A apagar…" : "Apagar mesmo"}
                </button>
              </div>
            </div>
          )}
          {msg && <span className="sel-msg">{msg}</span>}
        </div>
      )}

      {/* Estado vazio que diz de QUÊ está vazio e como sair de lá. Antes era um
          "Nenhum creator nesse recorte." solto, com o rodapé a piscar por baixo. */}
      {!list.length && !filtering && (
        <div className="empty">
          {q.trim()
            ? <>Nenhum creator para <strong>“{q.trim()}”</strong>{temFiltros && " com estes filtros"}.</>
            : <>Nenhum creator nesse recorte.</>}
          {temFiltro && <> <button className="psearch-clear" onClick={() => onLimpar?.()}>Limpar busca e filtros</button></>}
        </div>
      )}

      {view === "card" ? (
        <section className="grid" style={filtering ? { opacity: 0.45, transition: "opacity .15s" } : undefined}>
          {list.map((c, i) => (
            (
              <div key={c.id} className={`rl-selwrap ${sel[c.id] ? "rl-selon" : ""}`} style={{ position: "relative" }}>
                <label className="rl-selcheck" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={!!sel[c.id]} onChange={() => toggleSel(c)} aria-label={`selecionar ${c.name}`} />
                </label>
                <CreatorCard c={c} rank={i + 1} />
              </div>
            )
          ))}
        </section>
      ) : (
        <div className="rl-tablewrap" style={filtering ? { opacity: 0.45, transition: "opacity .15s" } : undefined}>
          <table className={`rl-table ${styles.tabela}`}>
            <thead>
              <tr>
                <th></th>
                {/* Colunas da rodada 2 de feedback (F3.1, set/2026): Creator · Tier · Creator's
                    Topic · Seguidores · Views médias · E.R. · Melhor plataforma · Tags · seta.
                    Cachê e CPe saíram — são números internos que o cliente não pediu; o território
                    e o nicho também (o Topic é o sub-nicho). Score KOL, Match e Radar já tinham
                    saído (set/2026): a tag diz o que a nota decidiu.
                    Não há "comentários médios" por linha na montagem da lista (lib/radar-base.js)
                    — fica na ficha. */}
                <th>Creator</th><th>Tier</th><th>Creator&apos;s Topic</th>
                <Th k="followers">Seguidores</Th><Th k="views">Views médias</Th><Th k="er">E.R.</Th>
                <th>Melhor plataforma</th><th>Tags</th><th><span className={styles.srOnly}>Abrir perfil</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                // Tier pela maior conta isolada (lib/list-filters.js · tierFollowers), não pelo
                // alcance somado da coluna Seguidores — decisão [D11], "por conta"
                const tier = tierDe(tierFollowers(c));
                // só um uuid entra no URL (pentest set/2026: nada de texto livre a chegar ao window.open)
                const href = `/creator/${encodeURIComponent(String(c.id))}`;
                // a linha inteira abre a ficha; checkbox, links e botões mantêm o seu clique
                const abrir = (e) => {
                  if (e.target.closest("input, a, button, label")) return;
                  // Cmd/Ctrl+clique: nada de window.open com variável (pentest set/2026, XSS) — o
                  // <Link> do nome já abre em nova aba nativamente; o clique simples navega
                  if (e.metaKey || e.ctrlKey) return;
                  router.push(href);
                };
                return (
                  <tr key={c.id} className={`${sel[c.id] ? "rl-rowsel" : ""} ${styles.linha}`} onClick={abrir}>
                    <td><input type="checkbox" checked={!!sel[c.id]} onChange={() => toggleSel(c)} aria-label={`selecionar ${c.name}`} /></td>
                    <td className={styles.creatorCel}>
                      <Link href={href} className="rl-name" title={c.name}>
                        {/* foto durável por id; morta → inicial, nunca a estrela (B4, set/2026) */}
                        <AvatarImg src={avatarSrc(c.avatar_url, c.id)} nome={c.name || c.handle} size={32}
                          className="rl-avatar" classeInicial="rl-avatar rl-avatar-empty" />
                        <span className="rl-nmwrap">
                          <span className="rl-nm">{c.name}</span>
                          <span className="rl-hd">@{c.handle}</span>
                        </span>
                      </Link>
                    </td>
                    <td><span className={`${styles.tier} ${styles[`tier_${tier}`] || ""}`}>{TIER_LABEL[tier]}</span></td>
                    <td className={styles.topic} title={c.top_subnicho || undefined}>{c.top_subnicho || <span className="rl-dim">—</span>}</td>
                    <td className="rl-num">{fmt(c.followers_combined ?? c.followers)}</td>
                    <td className="rl-num">{fmt(c.views_per_post ?? c.avg_views)}</td>
                    <td className="rl-num">{pct(c.eng_rate)}</td>
                    {/* a plataforma trazia colado um `· 41` sem rótulo, que era o Radar Score
                        outra vez — o número que contradizia a ficha, e sem dizer o que era */}
                    <td><span className="rl-nm">{platLabel(c.platform)}</span></td>
                    <td>
                      <span className="rl-badges">
                        {/* três tags, como no card, no casting e na ficha */}
                        {TAG_DE[c.classe]
                          ? <span className={`tag${TAG_DE[c.classe] !== "Pool" ? " gold" : ""}`}>{TAG_DE[c.classe]}</span>
                          : <span className="rl-dim">—</span>}
                        {/* o mesmo sinal do card: entrou pela busca por tema, não pelo nome */}
                        {c.tema_sim != null && <span className="tag" title={`Conteúdo próximo do tema buscado · ${Math.round(c.tema_sim * 100)}%`}>≈ tema</span>}
                      </span>
                    </td>
                    <td className={styles.setaCel}>
                      <Link href={href} className="seta-linha" aria-label={`Abrir o perfil de ${c.name}`}><Seta /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
