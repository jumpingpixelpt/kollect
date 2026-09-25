"use client";

import AvatarImg from "@/components/AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import ListDelete from "@/components/ListDelete";
import BigNumbers from "@/components/BigNumbers";
import BarraBusca from "@/components/BarraBusca";
import SquadExternal, { squadRequest } from "@/components/SquadExternal";
import { squadProjection } from "@/lib/squad-metrics";
import { r2 } from "@/lib/numeros";
import { TAG_LABEL } from "@/lib/casting";
import { CONCEITO } from "@/lib/conceitos";
import { mensagemErro } from "@/lib/erro-cliente";
import SquadDefesa from "@/components/SquadDefesa";
import { CURADORIAS, CURADORIA_LABEL, NOTAS_MAX } from "@/lib/squad-curadoria";
import { csvPtBr, linhasCsvSquad, nomeArquivo } from "@/lib/squad-csv";

// "Analisado" saiu da vista (feedback rodada 2, F2.2): o estado do pipeline só aparece
// enquanto há algo a dizer — "a analisar" cinzento no lugar dos números, ou a falha.
const EM_ANALISE = new Set(["aguardando", "processando"]);
const fmt = (value) => value == null ? "—" : value >= 1e6 ? `${r2(value / 1e6).toLocaleString("pt-BR")}M` : value >= 1e3 ? `${r2(value / 1e3).toLocaleString("pt-BR")}k` : Math.round(value).toLocaleString("pt-BR");
const pct = (value) => value == null ? "—" : `${r2(value).toLocaleString("pt-BR")}%`;
const numero = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const platformName = (platform) => ({ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" }[platform] || platform || "Rede não informada");
const handleText = (profile) => profile?.handle ? `@${profile.handle.replace(/^@/, "")}` : "";

// Big numbers primeiro e numa faixa baixa (feedback rodada 2, F2.1/L5): o número vem antes
// da explicação; "Se cada creator publicar uma vez" passa a uma linha curta com tooltip.
function SquadMetrics({ projection }) {
  const base = (n) => `${n} de ${projection.total} com dados`;
  const items = [
    { label: "Views estimadas", value: fmt(projection.views), sub: base(projection.base), title: CONCEITO.viewsEstimadas },
    { label: "Engajamento projetado", value: fmt(projection.eng), sub: base(projection.erBase), title: CONCEITO.engProjetado },
    { label: "E.R. conjunta", value: pct(projection.er), sub: base(projection.erBase), title: CONCEITO.erConjunta, destaque: true },
    { label: "Alcance somado", value: fmt(projection.alcance), sub: base(projection.alcanceBase), title: CONCEITO.alcanceSomado },
  ];
  return <section className="squad-projection" aria-label="Potencial da squad">
    <BigNumbers items={items} compacto ariaLabel="Potencial da squad" />
    <p className="squad-help squad-projection-note" title="Os indicadores acompanham as inclusões e remoções. Dados ausentes ficam fora do cálculo; “—” significa que ainda não há dados suficientes. As estimativas não garantem resultados.">
      Se cada creator publicar uma vez · estimativa baseada no histórico <span aria-hidden="true">ⓘ</span>
    </p>
  </section>;
}

// Engajamento = interações médias por peça. Não há média absoluta gravada por creator, então
// deriva-se de views médias × E.R. (E.R. = engajamentos ÷ views, lib/engagement.js) — a mesma
// conta da projeção da squad. Sem views ou sem taxa fica "—", nunca 0.
function linhaMetricas(item) {
  const m = item.creator_id ? item.metrics : null;
  const views = numero(m?.avg_views);
  const er = numero(m?.eng_rate);
  return { views, er, eng: views != null && er != null ? views * er / 100 : null, comentarios: numero(item.media_comentarios) };
}

const dataHora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

// Status da curadoria (F2.2, proposta da D7): grava no momento da escolha e volta ao valor
// anterior se a gravação falhar. É a decisão da equipa, não o estado da análise.
function CuradoriaCell({ item, listId, nome, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  async function mudar(event) {
    const valor = event.target.value, anterior = item.curadoria;
    if (valor === anterior) return;
    setSaving(true); setErro("");
    onSaved(item.id, { curadoria: valor });
    try {
      const r = await squadRequest("/api/lists", { action: "update_curadoria", list_id: listId, item_id: item.id, curadoria: valor });
      onSaved(item.id, r.item || { curadoria: valor });
    } catch (failure) {
      onSaved(item.id, { curadoria: anterior });
      setErro(failure.message || "Não foi possível gravar o status.");
    } finally { setSaving(false); }
  }
  return <>
    <select className={`squad-curadoria squad-curadoria-${item.curadoria}`} value={item.curadoria} onChange={mudar} disabled={saving}
      aria-label={`Status de ${nome}`}>
      {CURADORIAS.map((c) => <option key={c} value={c}>{CURADORIA_LABEL[c]}</option>)}
    </select>
    {erro && <span className="squad-error squad-row-error" role="alert">{erro}</span>}
  </>;
}

// Notas (F2.2): edição direta na célula, gravada ao sair do campo. O título mostra quem
// escreveu e quando (iniciais; o e-mail não chega ao navegador).
function NotaCell({ item, listId, nome, onSaved }) {
  const [valor, setValor] = useState(item.notas || "");
  const [estado, setEstado] = useState(""); // "" | "a gravar" | "salvo" | erro
  const gravado = useRef(item.notas || "");
  useEffect(() => { if (document.activeElement?.dataset?.notaId !== item.id) { setValor(item.notas || ""); gravado.current = item.notas || ""; } }, [item.notas, item.id]);
  async function gravar() {
    const texto = valor.trim();
    if (texto === gravado.current.trim()) return;
    setEstado("a gravar");
    try {
      const r = await squadRequest("/api/lists", { action: "update_curadoria", list_id: listId, item_id: item.id, notas: texto });
      gravado.current = r.item?.notas || "";
      onSaved(item.id, r.item || { notas: texto || null });
      setEstado("salvo");
      setTimeout(() => setEstado((e) => e === "salvo" ? "" : e), 2500);
    } catch (failure) { setEstado(failure.message || "Não foi possível gravar a nota."); }
  }
  const autoria = item.notas ? [item.notas_autor && `Nota de ${item.notas_autor}`, dataHora(item.notas_em)].filter(Boolean).join(" · ") : "";
  return <div className="squad-nota">
    <textarea value={valor} maxLength={NOTAS_MAX} rows={2} data-nota-id={item.id}
      placeholder="Adicionar nota…" aria-label={`Notas sobre ${nome}`} title={autoria || undefined}
      onChange={(e) => { setValor(e.target.value); if (estado && estado !== "a gravar") setEstado(""); }}
      onBlur={gravar} />
    {estado === "a gravar" && <span className="squad-nota-estado" role="status">a gravar…</span>}
    {estado === "salvo" && <span className="squad-nota-estado squad-nota-salvo" role="status">salvo</span>}
    {estado && estado !== "a gravar" && estado !== "salvo" && <span className="squad-error squad-row-error" role="alert">{estado}</span>}
    {!estado && autoria && <span className="squad-nota-estado">{autoria}</span>}
  </div>;
}

// «← Voltar aos creators do briefing» (F2.5): volta à última vista do briefing neste
// separador (filtros e linha aberta ficam no URL, guardado por components/BriefingContexto.js);
// sem ela, o briefing limpo. sessionStorage pode falhar (modo privado) — cai no link simples.
function useVoltarBriefing(campaignId) {
  const base = campaignId ? `/campanha/${campaignId}` : null;
  const [href, setHref] = useState(base);
  useEffect(() => {
    if (!base) return;
    try {
      const salvo = sessionStorage.getItem(`kollect:briefing-url:${campaignId}`);
      if (salvo && salvo.startsWith(`${base}?`)) setHref(salvo);
    } catch { /* sem sessionStorage */ }
  }, [base, campaignId]);
  return href;
}

export default function SquadDetail({ initialSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyId, setBusyId] = useState(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchId = useId();
  const busy = Boolean(busyId || externalBusy);
  const { list, items } = snapshot;
  const projection = useMemo(() => squadProjection(items), [items]);
  const included = useMemo(() => new Set(items.map((item) => item.creator_id).filter(Boolean)), [items]);
  const voltarBriefing = useVoltarBriefing(list.campaign_id);

  // Curadoria e notas mudam só o membro: sem recarregar a squad nem os indicadores.
  function patchItem(id, patch) {
    setSnapshot((s) => ({ ...s, items: s.items.map((row) => row.id === id ? { ...row, ...patch } : row) }));
  }

  // CSV (F2.4): `;` + BOM para o Excel pt-BR; mesmas contas da tabela (lib/squad-csv.js).
  function exportarCsv() {
    const url = URL.createObjectURL(new Blob([csvPtBr(linhasCsvSquad(items))], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo(list.name, "csv");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => { setSnapshot(initialSnapshot); }, [initialSnapshot]);
  useEffect(() => {
    const text = query.trim();
    setResults([]); setSearchError("");
    if (text.length < 2) { setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/lists/search?q=${encodeURIComponent(text)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data.error || data.fatal) throw new Error(mensagemErro(data, "Não foi possível buscar os perfis."));
        if (!controller.signal.aborted) setResults(data.creators || []);
      } catch (failure) { if (!controller.signal.aborted) setSearchError(failure.message || "Falha de rede. Tente novamente."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function applySnapshot(result) {
    const fresh = result.list && Array.isArray(result.items) ? result : await squadRequest(`/api/lists?id=${list.id}`);
    if (!fresh.list || !Array.isArray(fresh.items)) throw new Error("A squad foi alterada, mas não foi possível atualizar os indicadores. Atualize a página.");
    setSnapshot(fresh);
  }

  async function addCreator(creator) {
    if (busy || included.has(creator.id)) return;
    setBusyId(creator.id); setError(""); setMessage("");
    try {
      const result = await squadRequest("/api/lists", { action: "add_items", list_id: list.id, items: [{ creator_id: creator.id }] });
      await applySnapshot(result);
      setMessage(result.added === 0 ? "Este perfil já está na squad." : `${creator.name || handleText(creator)} incluído. Indicadores atualizados.`);
    } catch (failure) { setError(failure.message || "Não foi possível incluir o perfil."); }
    finally { setBusyId(null); }
  }

  async function removeItem(item) {
    if (busy) return;
    const previous = snapshot;
    const profile = item.creator || item.prospect;
    setBusyId(item.id); setError(""); setMessage("");
    // Remover só desfaz a associação com esta squad. Os indicadores reagem no mesmo
    // clique; em caso de falha de gravação, o membro e os números anteriores voltam.
    setSnapshot({ ...snapshot, items: items.filter((row) => row.id !== item.id) });
    let saved = false;
    try {
      const result = await squadRequest("/api/lists", { action: "remove_item", list_id: list.id, item_id: item.id });
      saved = true;
      await applySnapshot(result);
      setMessage(`${profile?.name || "Perfil"} removido desta squad. Indicadores atualizados.`);
    } catch (failure) {
      if (!saved) setSnapshot(previous);
      setError(failure.message || "Não foi possível remover o perfil.");
    } finally { setBusyId(null); }
  }

  return <>
    <div className="squad-nav">
      <nav className="squad-nav-links" aria-label="Navegação do squad">
        {voltarBriefing
          ? <Link href={voltarBriefing} className="back" title={list.campaign_name ? `Briefing: ${list.campaign_name}` : undefined}>← Voltar aos creators do briefing</Link>
          : <Link href="/listas" className="back">← Todas as squads</Link>}
        {voltarBriefing && <Link href="/listas" className="squad-nav-sec">Todas as squads</Link>}
        <Link href="/" className="squad-nav-sec">Nova busca</Link>
      </nav>
      <ListDelete listId={list.id} name={list.name} />
    </div>
    <header className="squad-title squad-title-compacto"><span className="squad-eyebrow">SQUAD</span><h1>{list.name}</h1>
      {list.campaign_id && list.campaign_name && <p className="squad-origem">Do briefing <Link href={voltarBriefing}>{list.campaign_name}</Link></p>}
    </header>
    <SquadMetrics projection={projection} />
    <div className="squad-actions">
      <SquadDefesa listId={list.id} listName={list.name} inicial={list.defesa} disabled={busy || !items.length} />
      <button type="button" className="squad-action" onClick={exportarCsv} disabled={!items.length}>↧ Exportar CSV</button>
    </div>
    <SquadExternal listId={list.id} disabled={busy} onBusy={setExternalBusy} onAdded={applySnapshot} />
    {snapshot.notifications?.enabled && snapshot.notifications?.ownerKnown && <p className="squad-notification">Avisos por e-mail ativos: quem criou esta squad será avisado quando um membro se tornar Rising Star.</p>}
    <section className="squad-members" aria-labelledby="squad-members-title">
      <div className="squad-section-heading"><div><span className="squad-eyebrow">SEU TIME</span><h2 id="squad-members-title">Creators da squad <span className="squad-count">{items.length}</span></h2></div></div>
      <div className="squad-search-panel">
        <span className="squad-search-label" id={`${searchId}-label`}>Adicionar da base</span>
        <BarraBusca value={query} onChange={setQuery} onClear={() => setQuery("")} acao={null} semForm busy={searching}
          placeholder="Busque por nome ou @perfil" ariaLabel="Adicionar da base: busque por nome ou @perfil"
          inputProps={{ id: searchId, "aria-controls": `${searchId}-results` }}>
          <div id={`${searchId}-results`} aria-busy={searching}>
            {searching && <p className="squad-search-status" role="status">Buscando perfis…</p>}
            {searchError && <p className="squad-error" role="alert">{searchError}</p>}
            {!searching && !searchError && query.trim().length >= 2 && !results.length && <p className="squad-search-status" role="status">Nenhum perfil encontrado. Use o link do perfil no campo acima para incluir alguém de fora da base.</p>}
            {!!results.length && <ul className="squad-search-results" aria-label="Perfis encontrados">{results.map((creator) => <li key={creator.id}>
              <div><strong>{creator.name || handleText(creator)}</strong><span>{handleText(creator)} · {platformName(creator.platform)} · {fmt(creator.followers)} seguidores</span></div>
              <button type="button" className="squad-small-button" disabled={busy || included.has(creator.id)} onClick={() => addCreator(creator)} aria-label={`Adicionar ${creator.name || handleText(creator)} à squad`}>{included.has(creator.id) ? "Já incluído" : busyId === creator.id ? "Incluindo…" : "+ Incluir"}</button>
            </li>)}</ul>}
          </div>
        </BarraBusca>
      </div>
      {error && <p className="squad-error" role="alert">{error}</p>}
      <p className="squad-feedback" role="status">{message}</p>
      {/* Tabela (feedback rodada 2, F2.2), com Status e Notas editáveis (list_creators.curadoria
          e .notas). Rola na horizontal dentro do próprio contentor em ecrãs estreitos, sem
          empurrar a página. */}
      {!!items.length && <div className="squad-table-wrap">
        <table className="squad-table" aria-label="Membros da squad" aria-busy={busy}>
          <thead><tr>
            <th scope="col">Creator</th>
            <th scope="col" className="num">Seguidores</th>
            <th scope="col" className="num">Views médias</th>
            <th scope="col" className="num" title="Média de comentários por peça">Comentários</th>
            <th scope="col" className="num" title="Interações médias por peça, estimadas como views médias × E.R.">Engajamento</th>
            <th scope="col" className="num" title="Engajamentos ÷ views, em %">E.R.</th>
            <th scope="col" title="Decisão da equipa: Sugerida, Em estudo, Aprovada ou Descartada">Status</th>
            <th scope="col">Notas</th>
            <th scope="col"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>{items.map((item) => {
            const profile = item.creator || item.prospect;
            const name = profile?.name || handleText(profile) || "Perfil indisponível";
            const emAnalise = EM_ANALISE.has(item.status);
            const m = linhaMetricas(item);
            const followers = numero(profile?.followers);
            // Sem nota na lista (feedback do cliente, set/2026): somente KOL, Rising
            // Star e Pool. Prospects ainda sem análise permanecem "A analisar".
            return <tr key={item.id}>
              <th scope="row" className="squad-cell-creator"><div className="squad-creator">
                {/* foto durável por id do creator (B4); prospect ou sem foto → inicial no mesmo círculo */}
                <AvatarImg src={item.creator_id ? avatarSrc(null, item.creator_id) : null} nome={name} size={42}
                  className="squad-avatar squad-avatar-img" classeInicial="squad-avatar" />
                <div className="squad-member-info">
                  <h3>{item.creator_id ? <Link href={`/creator/${item.creator_id}`}>{name}<span aria-hidden="true"> ↗</span></Link> : name}</h3>
                  <p>{handleText(profile)}{profile?.handle && " · "}{platformName(profile?.platform)}</p>
                  <span className={`squad-tag squad-tag-${item.tag || "pending"}`}>{TAG_LABEL[item.tag] || (item.creator_id ? "Sem classificação" : "A analisar")}</span>
                  {item.status === "erro" && <span className="squad-error squad-row-error">Falha na análise</span>}
                </div>
              </div></th>
              <td className="num">{followers == null && emAnalise ? <span className="squad-analisando">a analisar</span> : fmt(followers)}</td>
              {emAnalise
                ? <td className="num squad-analisando" colSpan={4}>a analisar</td>
                : <>
                  <td className="num">{fmt(m.views)}</td>
                  <td className="num">{fmt(m.comentarios)}</td>
                  <td className="num">{fmt(m.eng)}</td>
                  <td className="num">{pct(m.er)}</td>
                </>}
              <td className="squad-cell-status"><CuradoriaCell item={item} listId={list.id} nome={name} onSaved={patchItem} /></td>
              <td className="squad-cell-notas"><NotaCell item={item} listId={list.id} nome={name} onSaved={patchItem} /></td>
              <td className="squad-cell-acao"><button type="button" className="squad-remove" disabled={busy} onClick={() => removeItem(item)} aria-label={`Remover ${name} desta squad`} title="Remove apenas desta squad">Remover</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {!items.length && <div className="squad-empty"><strong>Sua squad começa aqui.</strong><p>Busque um creator na base ou inclua um perfil externo pelo link.</p></div>}
    </section>
  </>;
}
