"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { handleDoLink } from "@/lib/referencia";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * LIGAR A OUTRA CONTA — a mesma pessoa noutra rede, à mão.
 *
 * Feedback do cliente (set/2026, ponto 7): "unificar os perfis em um só". A ligação
 * automática (lib/pessoa.js) só apanha quem partilha id Tubular, bio ou handle; o match
 * pela foto que o cliente sugeriu ficou de fora (decisão do Rui, 11/09/2026). Aqui quem
 * conhece a creator escreve o @ ou o link da outra conta e as duas passam a partilhar o
 * person_key — a ficha mostra as contas irmãs e o casting colapsa-as numa linha.
 */
export default function LigarConta({ handle }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [outro, setOutro] = useState("");
  const [estado, setEstado] = useState(null);

  async function ligar() {
    const h = handleDoLink(outro);
    if (!h) return setEstado("escreve o @ ou o link da outra conta");
    if (h === String(handle).toLowerCase()) return setEstado("é esta conta");
    setEstado("a ligar…");
    try {
      const r = await fetch(`/api/link-person?handles=${encodeURIComponent(handle)},${encodeURIComponent(h)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.error) return setEstado(mensagemErro(d));
      if (!d.handles || d.handles.length < 2) return setEstado("não liguei — confirma o @");
      setEstado("ligada ✓");
      setTimeout(() => { setAberto(false); setEstado(null); router.refresh(); }, 600);
    } catch { setEstado("falha de rede — tente de novo"); }
  }

  if (!aberto) return <button className="chip" onClick={() => setAberto(true)} title="A mesma pessoa noutra rede">⧉ Ligar a outra conta</button>;

  return (
    <div className="fc-addlist">
      <input placeholder="@handle ou link da outra conta" value={outro} onChange={(e) => setOutro(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ligar()} />
      <button className="chip" onClick={ligar}>Ligar</button>
      <button className="chip" onClick={() => { setAberto(false); setEstado(null); }}>✕</button>
      {estado && <span className="fc-addlist-s">{estado}</span>}
    </div>
  );
}
