"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import FilterSelect from "@/components/FilterSelect";
import FilterMultiSelect from "@/components/FilterMultiSelect";
import { rotuloTermo, fmtN } from "@/lib/termos";

// Janela de descoberta. Sem ela, o que uma corrida acaba de trazer entra ordenado por mérito
// no meio de 40 mil linhas e não há forma de o isolar — o operador corre a descoberta, vê
// "83 novos prospects" e não consegue chegar a esses 83.
const JANELAS = [
  [null, "Qualquer data"],
  ["1", "Hoje"],
  ["3", "Últimos 3 dias"],
  ["7", "Últimos 7 dias"],
  ["30", "Últimos 30 dias"],
];

// mérito por omissão; "data" põe as importações mais recentes primeiro (afinação do cliente)
const ORDENS = [
  [null, "Melhor mini-score"],
  ["data", "Mais recentes"],
];


export default function ProspectSearch({ q = "", min = "", max = "", desde = "", ord = "", termosSel = [], termos = [] }) {
  const router = useRouter();
  const [vq, setVq] = useState(q);
  const [vmin, setVmin] = useState(min);
  const [vmax, setVmax] = useState(max);
  const [vdesde, setVdesde] = useState(String(desde || ""));
  const [vord, setVord] = useState(ord === "data" ? "data" : "");
  const [vtermos, setVtermos] = useState(termosSel);

  const go = (e) => {
    e?.preventDefault();
    const u = new URLSearchParams();
    if (vq.trim()) u.set("q", vq.trim());
    if (vmin) u.set("min", String(vmin));
    if (vmax) u.set("max", String(vmax));
    if (vdesde) u.set("desde", String(vdesde));
    for (const t of vtermos) u.append("termo", t);
    if (vord) u.set("ord", vord);
    router.push(`/descobertas?${u.toString()}`);
  };

  return (
    <form onSubmit={go} className="psearch">
      <input className="psearch-q" placeholder="Buscar por nome…" value={vq} onChange={(e) => setVq(e.target.value)} />
      <input className="psearch-n" placeholder="Seguidores mín." type="number" value={vmin} onChange={(e) => setVmin(e.target.value)} />
      <input className="psearch-n" placeholder="Seguidores máx." type="number" value={vmax} onChange={(e) => setVmax(e.target.value)} />
      <FilterSelect label="Descobertos" value={vdesde} options={JANELAS} minWidth={168}
        onChange={(v) => setVdesde(v || "")} />
      {/* o termo de busca que trouxe cada descoberta — o último item do badge de
          procedência ("dia a dia", "minoxidil", …). Seleção múltipla: 1, vários ou
          todos (lista vazia = sem filtro). A página só manda `termos` a admins, como o
          resto da procedência, portanto o dropdown nem aparece aos operadores. */}
      {termos.length > 0 && (
        <FilterMultiSelect label="Termo de busca" values={vtermos} minWidth={190}
          allLabel={`Todos os termos (${fmtN(termos.reduce((s, t) => s + t.n, 0))})`}
          options={termos.map((t) => [t.termo, `${rotuloTermo(t.termo)} (${fmtN(t.n)})`])}
          onChange={setVtermos} />
      )}
      <FilterSelect label="Ordenar" value={vord} options={ORDENS} minWidth={168}
        onChange={(v) => setVord(v || "")} />
      <button className="psearch-btn" type="submit">Filtrar</button>
      {(q || min || max || desde || ord || termosSel.length > 0) && (
        <button type="button" className="psearch-clear" onClick={() => { setVq(""); setVmin(""); setVmax(""); setVdesde(""); setVord(""); setVtermos([]); router.push("/descobertas"); }}>Limpar</button>
      )}
    </form>
  );
}
