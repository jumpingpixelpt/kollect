"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PromoteButton from "./PromoteButton";
import ProspectRemove from "./ProspectRemove";
import ErroComLink from "./ErroComLink";
import { motivoDaFalha } from "@/lib/promote-error";
import { r2 } from "@/lib/numeros";

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));

// URL e nome de exibição da plataforma — usados no link do nome e no link explícito
// "abrir perfil" do card (pedido do operador, jul/2026)
const urlPerfil = (it) => !it.handle ? null
  : it.platform === "instagram" ? `https://www.instagram.com/${it.handle}/`
    : it.platform === "youtube" ? `https://www.youtube.com/@${it.handle}`
      : it.platform === "x" ? `https://x.com/${it.handle}`
        : `https://www.tiktok.com/@${it.handle}`;
const PLAT = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };

/**
 * Lista de descobertas com selecao multipla. Acoes sobre a selecao (independentes):
 *  - Adicionar a lista (existente ou nova)
 *  - Adicionar a campanha (casting)
 *  - Aplicar tag (livre)
 *  - Evoluir para analise detalhada (promove + enrich)
 * Itens: { tubular_id?, creator_id?, name, handle, platform, followers, growth_30,
 *   eng_rate, mini_score, match_score?, rationale?, thumbnail?, status? }.
 */
/**
 * `hoje` vem do SERVIDOR, por prop, e não de um `new Date()` aqui.
 *
 * Duas razões, ambas de correcção e não de estilo. Primeira: isto é um client component, mas
 * o Next também o renderiza no servidor — calcular a data dos dois lados, em fusos diferentes,
 * dá mismatch de hidratação à meia-noite. Segunda: o `descoberto_em` é gravado pelas rotas com
 * `toISOString()`, ou seja em UTC, portanto comparar contra um "hoje" local marcaria as
 * descobertas como velhas uma hora antes do tempo. Compara-se no fuso em que o dado é escrito.
 */
export default function DiscoverySelection({ items = [], campaignId = null, campaignName = null, pageOffset = 0, lists = [], campaigns = [], tags = [], briefings = [], hoje = null, showFonte = false }) {
  const router = useRouter();
  const [sel, setSel] = useState({});
  const [rowState, setRowState] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [panel, setPanel] = useState(null); // "list" | "campaign" | "tag" | "briefing" | null
  const [listChoice, setListChoice] = useState("");
  const [briefChoice, setBriefChoice] = useState("");
  const [campChoice, setCampChoice] = useState(campaignId || "");
  const [tagText, setTagText] = useState("");
  const [msg, setMsg] = useState(null);

  const keyOf = (it) => (it.creator_id ? `c:${it.creator_id}` : `p:${it.tubular_id}`);
  const isPromoted = (it) => !!it.creator_id || it.status === "promovido";
  const toggle = (it) => { const k = keyOf(it); setSel((s) => ({ ...s, [k]: !s[k] })); };
  const selectedItems = items.filter((it) => sel[keyOf(it)]);
  const clearSel = () => { setSel({}); setPanel(null); };

  // ── selecionar a página inteira ──
  // Age só sobre os itens DESTA página (o `items` que o servidor mandou): a seleção
  // sobrevive à navegação entre páginas, portanto dá para somar várias páginas marcando
  // página a página — e desmarcar a página não toca no que veio das outras.
  const paginaToda = items.length > 0 && items.every((it) => sel[keyOf(it)]);
  const paginaParcial = !paginaToda && items.some((it) => sel[keyOf(it)]);
  const togglePagina = () => setSel((s) => {
    const n = { ...s };
    for (const it of items) { if (paginaToda) delete n[keyOf(it)]; else n[keyOf(it)] = true; }
    return n;
  });

  // alvo p/ tags: creator_id (no radar) ou prospect_id (tubular_id, ainda na descoberta)
  const targetsOf = () => selectedItems.map((it) => it.creator_id ? { creator_id: it.creator_id } : { prospect_id: it.tubular_id });
  // itens p/ listas, campanhas e briefings (carrega match/mini score; o termo de
  // busca vai junto — o briefing guarda a procedência de cada candidato)
  const itemsOf = () => selectedItems.map((it) => ({
    creator_id: it.creator_id ?? null,
    prospect_id: it.creator_id ? null : it.tubular_id,
    match_score: it.match_score ?? it.mini_score ?? null,
    termo: it.termo ?? null,
  }));

  async function addToList() {
    if (!selectedItems.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      let r;
      if (listChoice === "__new__" || (!listChoice && !lists.length)) {
        const name = window.prompt("Nome da nova squad list:", `Squad list ${new Date().toLocaleDateString("pt-BR")}`);
        if (!name) { setBusy(false); return; }
        r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, campaign_id: campaignId, items: itemsOf() }) });
      } else if (listChoice) {
        r = await fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_items", list_id: listChoice, items: itemsOf() }) });
      } else { setMsg("Escolha uma squad list."); setBusy(false); return; }
      const j = await r.json();
      const id = j.id || listChoice;
      setMsg(j.error ? `Erro: ${j.error}` : `${selectedItems.length} adicionada(s) à squad list ✓`);
      if (!j.error && id && id !== "__new__") setTimeout(() => router.push(`/listas?id=${id}`), 600);
      if (!j.error) { setPanel(null); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  // Briefing é brief-first: nasce em /briefings com nome + caracterização (o pedido do
  // cliente), nunca ad-hoc a partir da seleção — aqui só se anexam candidatos a um existente.
  async function addToBriefing() {
    if (!selectedItems.length || busy || !briefChoice) { if (!briefChoice) setMsg("Escolha um briefing."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/briefings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_members", briefing_id: briefChoice, items: itemsOf() }) });
      const j = await r.json();
      setMsg(j.error ? `Erro: ${j.error}` : `${j.added ?? 0} anexada(s) ao briefing ✓`);
      if (!j.error) { setPanel(null); setTimeout(() => router.push(`/briefings?id=${briefChoice}`), 600); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  async function addToCampaign() {
    if (!selectedItems.length || busy || !campChoice) { if (!campChoice) setMsg("Escolha uma campanha."); return; }
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
    if (!selectedItems.length || busy || !name) { if (!name) setMsg("Digite uma tag."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", name, targets: targetsOf() }) });
      const j = await r.json();
      setMsg(j.error ? `Erro: ${j.error}` : `Tag "${j.tag?.name || name}" aplicada a ${j.applied ?? 0} ✓`);
      if (!j.error) { setTagText(""); setPanel(null); router.refresh(); }
    } catch { setMsg("Falha de rede."); }
    setBusy(false);
  }

  async function evolve() {
    if (!selectedItems.length || busy) return;
    const suggested = campaignName ? `${campaignName}` : `Análise ${new Date().toLocaleDateString("pt-BR")}`;
    const name = window.prompt("Dê um nome para a squad list (as selecionadas serão adicionadas ao Radar com análise completa):", suggested);
    if (!name) return;
    setBusy(true); setProgress({ done: 0, total: selectedItems.length });

    let listId = null;
    try {
      const r = await fetch("/api/lists", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, campaign_id: campaignId,
          items: selectedItems.map((it) => ({
            creator_id: it.creator_id ?? null,
            prospect_id: it.creator_id ? null : it.tubular_id,
            match_score: it.match_score ?? it.mini_score ?? null,
          })),
        }),
      });
      const j = await r.json();
      listId = j.id || null;
    } catch { /* segue mesmo sem lista */ }

    let done = 0;
    for (const it of selectedItems) {
      const k = keyOf(it);
      if (isPromoted(it)) { done++; setProgress({ done, total: selectedItems.length }); continue; }
      setRowState((s) => ({ ...s, [k]: { st: "running" } }));
      try {
        const r = await fetch(`/api/promote?tubular_id=${encodeURIComponent(it.tubular_id)}`);
        const j = await r.json();
        const viaIc = j?.ok && j?.creator_id ? j : null;
        const viaTubular = j?.detalhes?.find((d) => d.ok);
        const ok = viaIc || viaTubular;
        if (ok?.creator_id) {
          if (viaTubular) fetch(`/api/enrich?handle=${encodeURIComponent(ok.handle)}`, { keepalive: true }).catch(() => {});
          setRowState((s) => ({ ...s, [k]: { st: "done", creatorId: ok.creator_id } }));
          if (listId) fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_item", list_id: listId, prospect_id: it.tubular_id, creator_id: ok.creator_id, status: "concluida" }) }).catch(() => {});
        } else {
          setRowState((s) => ({ ...s, [k]: { st: "error", msg: motivoDaFalha(j) } }));
          if (listId) fetch("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_item", list_id: listId, prospect_id: it.tubular_id, status: "erro" }) }).catch(() => {});
        }
      } catch {
        setRowState((s) => ({ ...s, [k]: { st: "error", msg: "rede / tempo esgotado" } }));
      }
      done++; setProgress({ done, total: selectedItems.length });
    }
    setBusy(false);
    if (listId) router.push(`/listas?id=${listId}`);
  }

  return (
    <>
      {selectedItems.length > 0 && (
        <div className="evolve-bar" style={{ flexWrap: "wrap", gap: 10 }}>
          <span className="evolve-count">{selectedItems.length} selecionada{selectedItems.length > 1 ? "s" : ""}</span>

          <button className="chip" onClick={() => setPanel(panel === "list" ? null : "list")} disabled={busy}>+ Squad List</button>
          <button className="chip" onClick={() => setPanel(panel === "briefing" ? null : "briefing")} disabled={busy}>+ Análise</button>
          <button className="chip" onClick={() => setPanel(panel === "campaign" ? null : "campaign")} disabled={busy}>+ Campanha</button>
          <button className="chip" onClick={() => setPanel(panel === "tag" ? null : "tag")} disabled={busy}>+ Tag</button>

          <button className="gold-btn" onClick={evolve} disabled={busy} style={{ whiteSpace: "nowrap" }}>
            {busy && progress ? `Adicionando ao radar… ${progress.done}/${progress.total}` : "Adicionar ao Radar ✦"}
          </button>
          {!busy && <button className="psearch-clear" onClick={clearSel}>Limpar seleção</button>}

          {panel === "list" && (
            <div className="sel-panel">
              <select className="filter-select" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
                <option value="">Escolher squad list…</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}{l.total != null ? ` (${l.total})` : ""}</option>)}
                <option value="__new__">+ Nova squad list…</option>
              </select>
              <button className="gold-btn" onClick={addToList} disabled={busy}>Adicionar à squad list</button>
            </div>
          )}
          {panel === "briefing" && (
            <div className="sel-panel">
              {briefings.length ? (
                <>
                  <select className="filter-select" value={briefChoice} onChange={(e) => setBriefChoice(e.target.value)}>
                    <option value="">Escolher análise…</option>
                    {briefings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <button className="gold-btn" onClick={addToBriefing} disabled={busy}>Anexar à análise</button>
                </>
              ) : (
                <span className="sel-msg">Nenhuma análise ainda — <Link href="/briefings" style={{ color: "var(--gold-bright)" }}>crie uma em Análise de dados</Link> (o pedido primeiro, os nomes depois).</span>
              )}
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
              <input className="rl-search" list="tag-options" placeholder="Tag (nova ou existente)…" value={tagText}
                onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyTag(); }} style={{ minWidth: 200 }} />
              <datalist id="tag-options">{tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              <button className="gold-btn" onClick={applyTag} disabled={busy}>Aplicar tag</button>
            </div>
          )}

          {msg && <span className="sel-msg">{msg}</span>}
        </div>
      )}

      {items.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", fontSize: 12.5, color: "var(--text-dim)", cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" className="dcheck" checked={paginaToda} disabled={busy}
            ref={(el) => { if (el) el.indeterminate = paginaParcial; }}
            onChange={togglePagina} aria-label="selecionar todos os desta página" />
          {paginaToda ? `Página inteira selecionada (${items.length})` : paginaParcial ? `Selecionar os ${items.length} desta página (algumas já marcadas)` : `Selecionar os ${items.length} desta página`}
        </label>
      )}
      <div className="dlist">
        {items.map((it, i) => {
          const k = keyOf(it);
          const rs = rowState[k];
          const promoted = isPromoted(it) || rs?.st === "done";
          const creatorId = it.creator_id || rs?.creatorId;
          return (
            <div className={`drow ${sel[k] ? "drow-sel" : ""}`} key={k}>
              <input type="checkbox" className="dcheck" checked={!!sel[k]} onChange={() => toggle(it)} disabled={busy} aria-label="selecionar creator" />
              <span className="rank" style={{ position: "static" }}>№ {pageOffset + i + 1}</span>
              {it.thumbnail
                ? <img className="davatar" src={`/api/thumb?u=${encodeURIComponent(it.thumbnail)}&v=3`} alt="" loading="lazy" />
                : <div className="davatar davatar-empty">★</div>}
              <div className="dinfo">
                <div className="dname">
                  {creatorId
                    ? <Link href={`/creator/${creatorId}`} style={{ color: "inherit" }}>{it.name} <span style={{ opacity: .6, fontSize: 12 }}>→ dossiê</span></Link>
                    : it.handle
                      ? <a href={urlPerfil(it)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{it.name} <span style={{ opacity: .6, fontSize: 12 }}>@{it.handle} ↗</span></a>
                      : it.name}
                </div>
                <div className="dmeta">
                  {fmt(it.followers)} seguidores · {it.growth_30 != null ? `${it.growth_30 > 0 ? "+" : ""}${r2(it.growth_30)}% /30d` : "—"} · eng {it.eng_rate != null ? `${r2(it.eng_rate)}%` : "—"}
                  {/* Data de importação: sem ela, uma descoberta de hoje é indistinguível de
                      uma de junho no meio de 40 mil linhas ordenadas por mérito. A procedência
                      (fonte + termo de busca) é detalhe de operação — só para admins (afinação
                      do cliente, jul/2026). */}
                  {it.descoberto_em ? <span className={`dwhen${it.descoberto_em === hoje ? " dwhen-novo" : ""}`}>
                    {it.descoberto_em === hoje ? "novo hoje" : it.descoberto_em}
                    {showFonte && it.fonte ? ` · ${it.fonte}` : ""}
                    {showFonte && it.termo ? ` · ${String(it.termo).slice(0, 60)}` : ""}
                  </span> : null}
                  {/* Mais contexto no card (pedido do operador, jul/2026): link explícito para
                      o perfil, o vídeo que a descobriu, nicho, volume e cadência. */}
                  <span style={{ display: "block", marginTop: 4 }}>
                    {[
                      urlPerfil(it) && <a key="perfil" href={urlPerfil(it)} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>abrir perfil {PLAT[it.platform] || it.platform || ""} ↗</a>,
                      !urlPerfil(it) && it.platform && <span key="plat">{PLAT[it.platform] || it.platform}</span>,
                      it.post_url && <a key="post" href={it.post_url} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>vídeo da descoberta ↗</a>,
                      it.genre && <span key="genre">{it.genre}</span>,
                      it.views_total != null && <span key="views">{fmt(it.views_total)} views totais</span>,
                      it.uploads_90 != null && <span key="up90">{it.uploads_90} vídeos/90d</span>,
                      it.last_upload && <span key="last">últ. post {it.last_upload}</span>,
                    ].filter(Boolean).map((el, i) => <span key={el.key || i}>{i > 0 ? " · " : ""}{el}</span>)}
                  </span>
                  {it.rationale ? <span style={{ display: "block", marginTop: 4, color: "var(--text-dim)", fontStyle: "italic" }}>✦ {it.rationale}</span> : null}
                </div>
              </div>
              <div className="dscore">
                <div className="v">{(it.match_score ?? it.mini_score) != null ? Number(it.match_score ?? it.mini_score).toFixed(0) : "—"}</div>
                {/* Sem score não é o mesmo que score zero: as descobertas por legenda e por CSV
                    só trazem handle e seguidores, e o mini-score precisa de crescimento,
                    engajamento e cadência. Dizer "sem métricas" evita que o "—" seja lido como
                    falha de render — ou, pior, como nota baixa. */}
                <div className="k" title={(it.match_score ?? it.mini_score) != null ? undefined : "Descoberta sem métricas de crescimento/engajamento — o mini-score só é calculável depois de enriquecer o perfil"}>
                  {it.match_score != null ? "match" : it.mini_score != null ? "mini-score" : "sem métricas"}
                </div>
              </div>
              <div style={{ textAlign: "right", minWidth: 130, display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                {promoted ? <span className="tag gold">no radar ✓</span>
                  : rs?.st === "running" ? <span className="tag">promovendo… (~1 min)</span>
                    : rs?.st === "error" ? <span className="tag" style={{ color: "var(--red)" }}><ErroComLink texto={rs.msg} /></span>
                      : <PromoteButton tubularId={it.tubular_id} status={it.status} />}
                {/* Toda descoberta pode sair da fila — em especial as que falham a promoção
                    (homónima suspeita, perfil privado): sem isto ficavam a poluir a página
                    para sempre (pedido do operador, jul/2026). */}
                {!promoted && it.tubular_id ? <ProspectRemove tubularId={it.tubular_id} nome={it.name || (it.handle ? `@${it.handle}` : null)} /> : null}
              </div>
            </div>
          );
        })}
        {!items.length && <div className="dmeta" style={{ padding: 24 }}>Nenhuma creator fora do radar neste filtro — todas as sugestões já foram adicionadas. ✓</div>}
      </div>
    </>
  );
}
