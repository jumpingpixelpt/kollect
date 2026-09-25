import { internalHeaders } from "./internal-fetch.js";

// As tags das squads vêm do Score KOL, não do Radar Score. Ambos usam apenas dados
// já gravados: retomar um cálculo interrompido não dispara outra coleta paga.
export function squadScoreTargets(creators, members, snapshots, collected) {
  const squadIds = new Set(members.map((member) => member.creator_id).filter(Boolean));
  const collectedIds = new Set(collected.map((creator) => creator.id));
  const latest = new Map();
  for (const snapshot of snapshots) {
    const day = String(snapshot.captured_at || "").slice(0, 10);
    if (day > (latest.get(snapshot.creator_id) || "")) latest.set(snapshot.creator_id, day);
  }
  return creators.filter((creator) => squadIds.has(creator.id) && (
    collectedIds.has(creator.id) ||
    // O legado grava só a data do cálculo: na mesma data não dá para garantir que
    // ele veio depois do snapshot. Recalcular é gratuito e cobre uma falha nesse dia.
    (latest.has(creator.id) && latest.get(creator.id) >= String(creator.kol_calculado_em || "").slice(0, 10))
  ));
}

/** Orçamento compartilhado: nenhuma autochamada pode ultrapassar o prazo do cron. */
export async function refreshCollectionScores({
  collected, squadTargets, requestUrl, deadline, fetchImpl = fetch, now = Date.now,
}) {
  const squadIds = new Set(squadTargets.map((creator) => creator.id));
  const targets = [...new Map([...squadTargets, ...collected].map((creator) => [creator.id, creator])).values()];
  const report = { rescorados: 0, tags_atualizadas: 0, rescore_falhas: 0, tags_falhas: 0,
    rescore_pendentes: targets.length, tags_pendentes: squadIds.size, erros_scores: [] };

  const call = async (path, creator, method) => {
    const remaining = deadline - now();
    if (remaining <= 0) return { skipped: true };
    try {
      const url = new URL(path, requestUrl);
      url.searchParams.set("id", creator.id);
      const response = await fetchImpl(url, {
        method, headers: internalHeaders(), cache: "no-store",
        signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, Math.floor(remaining)))),
      });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const body = await response.json();
      if (!body || body.error || body.fatal || body.err || body.incompleto || body.gravado === false) {
        return { error: String(body?.error || body?.fatal || body?.err || "Cálculo não concluído").slice(0, 160) };
      }
      const saved = path === "/api/kol-score" ? body.gravado === true : body.creator_id === creator.id;
      return saved ? { ok: true } : { error: "Resposta sem confirmação de gravação" };
    } catch (error) {
      return { error: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Tempo de recálculo esgotado" : "Falha ao recalcular o creator" };
    }
  };
  const failure = (creator, step, error) => {
    if (report.erros_scores.length < 20) report.erros_scores.push({ creator_id: creator.id, etapa: step, error });
  };

  // Membros das squads primeiro: uma fila grande da base não pode consumir toda a
  // margem antes de atualizar as classificações usadas pelos avisos de crescimento.
  for (let offset = 0; offset < targets.length && now() < deadline; offset += 4) {
    await Promise.all(targets.slice(offset, offset + 4).map(async (creator) => {
      const score = await call("/api/score", creator, "POST");
      if (score.skipped) return;
      report.rescore_pendentes--;
      if (score.ok) report.rescorados++;
      else {
        report.rescore_falhas++;
        failure(creator, "score", score.error);
        return; // sem Radar Score confirmado, a tag continua pendente para nova tentativa
      }
      if (!squadIds.has(creator.id)) return;
      const kol = await call("/api/kol-score", creator, "GET");
      if (kol.skipped) return;
      report.tags_pendentes--;
      if (kol.ok) report.tags_atualizadas++;
      else { report.tags_falhas++; failure(creator, "kol-score", kol.error); }
    }));
  }
  return report;
}
