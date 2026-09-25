"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErro } from "@/lib/erro-cliente";

export async function squadRequest(path, body) {
  const response = await fetch(path, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => null);
  // Os endpoints também devolvem falhas de negócio em HTTP 200.
  if (!response.ok || !result || result.error || result.fatal || result.ok === false) {
    throw new Error(mensagemErro(result, "Não foi possível atualizar a squad. Tente novamente."));
  }
  return result;
}

export default function SquadExternal({ listId, lists = [], disabled = false, onBusy, onAdded }) {
  const router = useRouter();
  const inputId = useId();
  const [selected, setSelected] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retryId, setRetryId] = useState(null);
  const [includedListId, setIncludedListId] = useState(null);
  const target = listId || selected;

  async function include(event) {
    event.preventDefault();
    if (busy || disabled || !target || !url.trim()) return;
    setBusy(true); onBusy?.(true); setError(""); setMessage(""); setRetryId(null); setIncludedListId(null);
    let included = false;
    let analysisPending = false;
    try {
      const result = await squadRequest("/api/lists/external", { list_id: target, url: url.trim() });
      included = true;
      setIncludedListId(target);
      if (onAdded) await onAdded(result);
      setUrl("");
      if (result.needsAnalysis && result.analysisBlocked) {
        analysisPending = true;
        // A cadeia legada usa o @: perfis homônimos em redes diferentes precisam
        // permanecer pendentes, sem iniciar a análise de outra conta por engano.
        setError("Perfil incluído. A análise automática está pendente porque não foi possível identificar uma única conta para este @.");
      } else if (result.needsAnalysis && result.handle) {
        setMessage("Perfil incluído. Analisando o histórico e a classificação…");
        try {
          await squadRequest("/api/lists/analyze", { list_id: target, creator_id: result.id });
        } catch (failure) {
          analysisPending = true;
          setError(failure.message || "O perfil está na squad, mas a análise ficou incompleta. Você pode retomá-la na ficha.");
          setRetryId(result.id || null);
        }
        if (onAdded) await onAdded(await squadRequest(`/api/lists?id=${target}`));
      }
      setMessage(result.added === 0 ? "Este perfil já está na squad. Indicadores atualizados." : "Perfil incluído. Os indicadores foram atualizados.");
      // No índice, conserva a explicação de uma análise pendente. Navegar
      // automaticamente apagaria o aviso antes que a pessoa pudesse lê-lo.
      if (!onAdded && !analysisPending) { router.push(`/listas?id=${target}`); router.refresh(); }
    } catch (failure) {
      setError(included ? "O perfil foi incluído, mas não foi possível atualizar os indicadores. Atualize a página." : failure.message || "Não foi possível incluir o perfil. Tente novamente.");
    } finally { setBusy(false); onBusy?.(false); }
  }

  // Uma linha só (feedback rodada 2, F2.1): rótulo pequeno + link + botão, sem eyebrow nem
  // título grande. O rótulo do campo continua a nomear a secção para leitores de ecrã.
  return <section className="squad-external" aria-labelledby={`${inputId}-title`}>
    <form onSubmit={include} className="squad-external-form" aria-busy={busy}>
      <span className="squad-external-label" id={`${inputId}-title`}>Incluir perfil externo <span className="opcional">(opcional)</span></span>
      {!listId && lists.length > 0 && <label className="squad-field squad-field-inline"><span className="sr-only">Squad de destino</span><select required value={selected} onChange={(event) => setSelected(event.target.value)} disabled={disabled || busy} aria-label="Squad de destino"><option value="">Squad de destino</option>{lists.map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}</select></label>}
      <label className="squad-field squad-field-inline squad-url" htmlFor={inputId}><span className="sr-only">Link do perfil no Instagram ou TikTok</span><input id={inputId} type="text" inputMode="url" autoComplete="off" required value={url} placeholder="Link do Instagram ou TikTok — instagram.com/perfil" disabled={disabled || busy || (!listId && !lists.length)} onChange={(event) => { setUrl(event.target.value); setError(""); setMessage(""); }} /></label>
      <button className="gold-btn" type="submit" disabled={disabled || busy || !target || !url.trim()}>{busy ? "Incluindo…" : "+ Incluir"}</button>
    </form>
    {!listId && !lists.length && <p className="squad-help">Crie sua primeira squad abaixo para começar.</p>}
    {busy && <p className="squad-help" role="status">Estamos buscando o perfil e seu histórico. Isso pode levar alguns minutos.</p>}
    {error && <p className="squad-error" role="alert">{error}{retryId && <> <a href={`/creator/${retryId}`}>Abrir ficha →</a></>}{!listId && includedListId && <> <a href={`/listas?id=${includedListId}`}>Abrir squad →</a></>}</p>}
    <p className="squad-feedback" role="status">{message}</p>
  </section>;
}
