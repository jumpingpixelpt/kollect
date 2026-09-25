"use client";
import { useState } from "react";
// Cliente de browser COM sessão: o upsert_crm passou a exigir `authenticated`
// (era executável por anon — WhatsApp e e-mail de creators escritos por qualquer um).
import { supabaseBrowser } from "@/lib/auth";

const STATUSES = [
  ["nao_contatado", "Não contatado"],
  ["contatado", "Contatado"],
  ["negociando", "Em negociação"],
  ["fechado", "Fechado"],
  ["descartado", "Descartado"],
];

export default function CrmPanel({ creatorId, creatorName, handle, platform, initial, bare }) {
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [status, setStatus] = useState(initial?.status ?? "nao_contatado");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [st, setSt] = useState("idle");

  async function save(nextStatus) {
    const s = nextStatus ?? status;
    if (nextStatus) setStatus(nextStatus);
    setSt("saving");
    const { error } = await supabaseBrowser().rpc("upsert_crm", {
      p_creator: creatorId, p_whatsapp: whatsapp || null, p_email: email || null, p_status: s, p_notes: notes || null,
    });
    setSt(error ? "error" : "ok");
    if (!error) setTimeout(() => setSt("idle"), 1800);
  }

  const phone = (whatsapp || "").replace(/\D/g, "");
  const waMsg = encodeURIComponent(`Oi ${creatorName.split(" ")[0]}! Aqui é da equipe L'Oréal — adoramos seu conteúdo e queremos conversar sobre uma parceria. Pode falar?`);
  const waUrl = phone ? `https://wa.me/${phone.length <= 11 ? "55" + phone : phone}?text=${waMsg}` : null;
  const dmUrl = platform === "instagram" ? `https://ig.me/m/${handle}` : `https://www.tiktok.com/@${handle}`;

  return (
    <div className={bare ? "" : "panel"} style={bare ? {} : { marginBottom: 22 }}>
      {!bare && <h3>CRM <span>· primeiro contato</span></h3>}

      <div className="crm-status">
        {STATUSES.map(([k, label]) => (
          <button key={k} className={`chip ${status === k ? "active" : ""}`} onClick={() => save(k)}>{label}</button>
        ))}
      </div>

      <div className="crm-fields">
        <div className="cache-input">
          <span className="prefix">☎</span>
          <input type="tel" placeholder="WhatsApp — ex: 11 91234-5678" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </div>
        <div className="cache-input">
          <span className="prefix">@</span>
          <input type="email" placeholder="e-mail (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>

      <textarea className="crm-notes" placeholder="Notas da negociação — cachê conversado, datas, contexto…"
        value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />

      <div className="crm-actions">
        <a className={`gold-btn crm-btn ${!waUrl ? "disabled" : ""}`} href={waUrl || undefined}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => { if (!waUrl) e.preventDefault(); else if (status === "nao_contatado") save("contatado"); }}>
          WhatsApp ↗
        </a>
        <a className="ghost-btn crm-btn" href={dmUrl} target="_blank" rel="noopener noreferrer"
          onClick={() => { if (status === "nao_contatado") save("contatado"); }}>
          DM no {platform === "instagram" ? "Instagram" : "TikTok"} ↗
        </a>
        <button className="ghost-btn crm-btn" onClick={() => save()} disabled={st === "saving"}>
          {st === "saving" ? "Salvando…" : st === "ok" ? "Salvo ✓" : st === "error" ? "Erro" : "Salvar"}
        </button>
      </div>
      {!phone && <div className="formula-note" style={{ marginTop: 12 }}>Preencha o WhatsApp pra liberar o botão de contato — abrir o WhatsApp ou a DM já move o status pra "Contatado".</div>}
    </div>
  );
}
