"use client";

import { useEffect } from "react";

/**
 * Contexto da página de Creators de um briefing (feedback rodada 2, F2.5 — set/2026).
 * Não desenha nada; três efeitos:
 *
 * 1. «Recentemente aberto por você»: regista a abertura no servidor (POST /api/buscas
 *    { action: "aberto" }) a partir de QUALQUER entrada — Histórico, link direto, «voltar»
 *    do squad —, com keepalive para não se perder se a pessoa sair logo. Best-effort.
 * 2. Linha expandida no URL: abrir/fechar um card grava ?aberto=<creator_id> com
 *    history.replaceState (sem nova entrada no histórico nem novo pedido ao servidor). Ao
 *    voltar, a página já vem com essa linha aberta (CreatorResultRow `aberto`) e aqui só se
 *    faz o scroll até ela.
 * 3. Guarda a vista atual (filtros + linha aberta) em sessionStorage, para o «← Voltar aos
 *    creators do briefing» do squad (components/SquadDetail.js) regressar a ela.
 */
export default function BriefingContexto({ campaignId, aberto = null }) {
  useEffect(() => {
    if (!campaignId) return;
    const chave = `kollect:briefing-url:${campaignId}`;
    const guardar = () => { try { sessionStorage.setItem(chave, window.location.pathname + window.location.search); } catch { /* sem sessionStorage */ } };
    guardar();

    try {
      fetch("/api/buscas", {
        method: "POST", keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "aberto", campaign_id: campaignId }),
      }).catch(() => {});
    } catch { /* o registo nunca atrapalha a página */ }

    if (aberto) {
      const el = document.getElementById(`creator-${aberto}`);
      if (el) {
        el.open = true;
        el.style.scrollMarginTop = "72px"; // abaixo da barra de filtros fixa
        requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
      }
    }

    // `toggle` não borbulha: escuta-se na fase de captura
    const onToggle = (event) => {
      const el = event.target;
      if (!(el instanceof HTMLDetailsElement) || !el.dataset.creatorId) return;
      const url = new URL(window.location.href);
      if (el.open) url.searchParams.set("aberto", el.dataset.creatorId);
      else if (url.searchParams.get("aberto") === el.dataset.creatorId) url.searchParams.delete("aberto");
      else return;
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      guardar();
    };
    document.addEventListener("toggle", onToggle, true);
    return () => document.removeEventListener("toggle", onToggle, true);
  }, [campaignId, aberto]);

  return null;
}
