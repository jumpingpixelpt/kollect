// Alertas de Squad: a classificação é persistida pelo pipeline; não há chamadas
// pagas para avaliar crescimento durante o envio de notificações.
export function isSquadEmailConfigured(env = process.env) {
  return env.VERCEL_ENV !== "preview" && env.SQUAD_ALERTS_ENABLED === "1"
    && Boolean(env.RESEND_API_KEY?.trim() && env.SQUAD_EMAIL_FROM?.trim());
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

export function squadAlertMessage(alert, env = process.env) {
  const site = new URL(env.SQUAD_APP_URL || "https://www.kollect.online");
  if (site.protocol !== "https:") throw new Error("SQUAD_APP_URL deve usar HTTPS");
  const link = new URL("/listas", site.origin);
  link.searchParams.set("id", alert.list_id);
  const url = link.href;
  const name = alert.creator_handle ? `@${alert.creator_handle.replace(/^@/, "")}` : alert.creator_name;
  const text = `${name} passou a Rising Star no seu squad “${alert.list_name}”.\n\nA classificação foi atualizada com base nas métricas disponíveis na KOLLECT. Confira os dados e as evidências do perfil no squad:\n${url}\n\nVocê recebeu este aviso porque criou este squad.`;
  return {
    from: env.SQUAD_EMAIL_FROM,
    to: [alert.recipient_email],
    subject: `Uma nova Rising Star no squad ${alert.list_name}`.replace(/[\r\n]/g, " ").slice(0, 200),
    text,
    html: `<p><strong>${escapeHtml(name)}</strong> passou a <strong>Rising Star</strong> no seu squad <strong>${escapeHtml(alert.list_name)}</strong>.</p><p>A classificação foi atualizada com base nas métricas disponíveis na KOLLECT. Confira os dados e as evidências do perfil.</p><p><a href="${escapeHtml(url)}">Ver squad</a></p><p>Você recebeu este aviso porque criou este squad.</p>`,
  };
}

// Resend mantém a chave por 24 h. A fila pausa tentativas incertas após 23 h,
// sem gerar outra chave e correr o risco de duplicar um e-mail já aceito.
// https://resend.com/docs/dashboard/emails/idempotency-keys
export async function sendSquadEmail(alert, message, { env = process.env, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `squad-rising/${alert.id}` },
      body: JSON.stringify(message),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    const error = new Error("Falha de conexão com o serviço de e-mail");
    error.retryable = true;
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) {
    const error = new Error(`Serviço de e-mail respondeu HTTP ${response.status}${response.ok ? " sem confirmação" : ""}`);
    // Um 409 por requisição concorrente é transitório; conflito de payload não é.
    error.retryable = response.status === 429 || response.status >= 500 || response.ok
      || (response.status === 409 && data?.name === "concurrent_idempotent_requests");
    throw error;
  }
  return data.id;
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

export async function processSquadAlerts(db, { env = process.env, fetchImpl = fetch, limit = 20 } = {}) {
  if (!isSquadEmailConfigured(env)) return { ok: true, skipped: "e-mail de squads não configurado ou ambiente de preview" };
  const queued = await rpc(db, "squad_collect_alerts");
  const result = { ok: true, queued, sent: 0, failed: 0 };
  for (let index = 0; index < Math.min(Math.max(limit, 0), 20); index++) {
    const claimed = await rpc(db, "squad_claim_alert", { p_limit: 1 });
    if (!Array.isArray(claimed)) throw new Error("Resposta incompleta ao reservar alerta");
    const alert = claimed[0];
    if (!alert) break;
    let message = alert.request_body;
    if (!message) {
      message = squadAlertMessage(alert, env);
      const { data, error } = await db.from("squad_alerts").update({ request_body: message })
        .eq("id", alert.id).eq("claim_token", alert.claim_token).eq("status", "processing").select("id");
      if (error) throw new Error(`Não foi possível preparar o alerta: ${error.message}`);
      if (!data?.length) continue; // O membro/squad foi removido durante a reserva.
    }
    // Confere novamente a associação antes de enviar uma reserva já preparada.
    const { data: member, error: memberError } = await db.from("list_creators").select("id")
      .eq("id", alert.membership_id).eq("creator_id", alert.creator_id).eq("list_id", alert.list_id).maybeSingle();
    if (memberError) throw new Error(`Não foi possível conferir o membro: ${memberError.message}`);
    if (!member) continue;
    let providerId;
    try {
      providerId = await sendSquadEmail(alert, message, { env, fetchImpl });
    } catch (error) {
      await rpc(db, "squad_finish_alert", {
        p_id: alert.id, p_token: alert.claim_token,
        p_status: error.retryable ? "pending" : "failed", p_error: error.message, p_provider_id: null,
      });
      result.failed++;
      result.ok = false;
      continue;
    }
    // Uma falha de confirmação no banco nunca transforma um envio aceito em nova
    // mensagem. A próxima execução reutiliza o corpo e a chave de idempotência.
    await rpc(db, "squad_finish_alert", {
      p_id: alert.id, p_token: alert.claim_token, p_status: "sent", p_error: null, p_provider_id: providerId,
    });
    result.sent++;
  }
  return result;
}
