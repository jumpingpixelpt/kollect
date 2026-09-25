"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * Caixa do Briefing Match. A escolha de audiência é explícita porque o briefing do
 * cliente (§4) define DOIS briefings dentro da ferramenta — um geral, feminino, e um
 * masculino (capilar de queda/crescimento), onde o cliente tem dificuldade histórica de
 * achar creators homens. O género da audiência é o que separa os dois castings: entra
 * como parsed.publico_alvo e vira multiplicador de aderência no fit (api/campaign).
 * Abre em "Audiência feminina" por ser o público-alvo principal do cliente (§4) e o
 * briefing geral. "Detetar do briefing" fica como 3ª opção para os briefings sem eixo de
 * género — a plataforma é multi-cliente e há campanhas legítimas com publico_alvo "ambos".
 */
const PUBLICOS = [
  { v: "feminino", label: "Audiência feminina", hint: "Casting priorizado por audiência feminina — o briefing geral, universo mais amplo da plataforma." },
  { v: "masculino", label: "Audiência masculina", hint: "Casting priorizado por audiência masculina — o 2º briefing, base de creators mais restrita." },
  { v: "auto", label: "Detetar do briefing", hint: "A IA lê o texto e decide o público-alvo. Usa quando o briefing não é de um dos dois eixos do cliente." },
];

export default function BriefingBar({ defaultOpen = false, embedded = false, fixos = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen || embedded);
  const [txt, setTxt] = useState("");
  const [publico, setPublico] = useState("feminino");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const go = async () => {
    if (!txt.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/campaign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefing: txt, publico }) });
      const j = await r.json();
      if (j.id) router.push(`/creators?c=${j.id}`);
      else { setErr(mensagemErro(j, "Não foi possível gerar a busca. Tente de novo em alguns minutos.")); setBusy(false); }
    } catch { setErr("Sem ligação ao servidor. Verifique a internet e tente de novo."); setBusy(false); }
  };

  if (!open && !embedded) return (
    <button className="briefing-toggle" onClick={() => setOpen(true)}>✦ Briefing Match — cole um briefing e receba o casting</button>
  );

  return (
    <div className="briefing-box">
      <textarea
        className="briefing-ta"
        rows={5}
        placeholder={"Cole o briefing da campanha. Ex.:\nCuidado capilar — queda e crescimento, rotina real e prova de resultado, TikTok e Instagram…"}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        disabled={busy}
      />

      <div className="briefing-aud">
        <span className="filter-label">Audiência do briefing</span>
        <div className="filter-select-wrap">
          <select className="filter-select briefing-aud-sel" value={publico} onChange={(e) => setPublico(e.target.value)} disabled={busy}>
            {PUBLICOS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <span className="filter-caret">▾</span>
        </div>
        <span className="briefing-aud-hint">{PUBLICOS.find((p) => p.v === publico)?.hint}</span>
      </div>

      <div className="briefing-actions">
        <button className="psearch-btn" onClick={go} disabled={busy || !txt.trim()}>
          {busy ? "Interpretando briefing e cruzando com o universo… ~1 min" : "Gerar casting ✦"}
        </button>
        {!busy && !embedded && <button className="psearch-clear" onClick={() => setOpen(false)}>Fechar</button>}
        {err && <span className="briefing-err">{err}</span>}
      </div>

      {/* Os dois briefings do cliente já existem como campanhas processadas — sem esta porta
          ficavam misturados nas Active Briefings, ordenados por data, e eram recriados à mão. */}
      {fixos.length > 0 && (
        <div className="briefing-fixos">
          <span className="filter-label">Ou abre um briefing do cliente</span>
          <div className="briefing-fixos-row">
            {fixos.map((f) => (
              <Link key={f.id} href={`/campanha/${f.id}`} className="briefing-fixo">
                <span className="briefing-fixo-t">
                  <span className="briefing-fixo-ic">{f.publico_alvo === "masculino" ? "♂" : "♀"}</span> {f.name}
                </span>
                <span className="briefing-fixo-d">
                  {f.publico_alvo === "masculino" ? "Audiência masculina" : "Audiência feminina"}
                  {f.total ? ` · ${f.total} no casting` : ""}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
