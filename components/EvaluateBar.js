"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErro } from "@/lib/erro-cliente";

export default function EvaluateBar() {
  const [url, setUrl] = useState("");
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");
  const router = useRouter();

  async function evaluate() {
    const urls = url.split(/[\s,]+/).map((u) => u.trim()).filter((u) => u.length > 8).slice(0, 3);
    if (!urls.length) return;
    setSt("loading"); setMsg("");
    const ok = [];
    try {
      for (let i = 0; i < urls.length; i++) {
        setMsg(`Avaliando perfil ${i + 1} de ${urls.length}…`);
        const res = await fetch("/api/evaluate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[i] }),
        });
        const data = await res.json();
        if (res.ok) ok.push(data);
        else if (urls.length === 1) { setSt("error"); setMsg(mensagemErro(data, "Erro ao avaliar.")); return; }
      }
      if (!ok.length) { setSt("error"); setMsg("Nenhum perfil avaliado — confira os links."); return; }

      // 2+ redes da mesma pessoa: vincula automaticamente (abas + card único)
      if (ok.length > 1) {
        setMsg("Vinculando as redes…");
        await fetch(`/api/link-person?handles=${ok.map((o) => o.handle).join(",")}`).catch(() => {});
      }
      // O enriquecimento era disparado aqui em fire-and-forget, com `.catch(() => {})`, e a
      // navegação acontecia na linha seguinte: se a cadeia falhasse — foi o que aconteceu
      // quando as chamadas internas começaram a levar 401 — o operador aterrava numa ficha
      // vazia e não havia, em lado nenhum, uma linha a dizer porquê. O perfil para onde
      // navegamos passa a ser enriquecido pela PRÓPRIA ficha, via `?novo=1`, reaproveitando
      // o EnrichButton: mesmo estado, mesma leitura do resumo, mesma mensagem de erro à
      // vista de quem importou. As contas-irmãs (2.º e 3.º links da mesma pessoa) continuam
      // em segundo plano — ninguém está a olhar para elas, e ficam a um clique nas abas de
      // rede, onde o botão reporta o que aconteceu.
      for (const o of ok.slice(1)) fetch(`/api/enrich?handle=${encodeURIComponent(o.handle)}`, { keepalive: true }).catch(() => {});

      setSt("idle"); setUrl(""); setMsg("");
      router.push(`/creator/${ok[0].id}?novo=1`);
    } catch { setSt("error"); setMsg("Erro de rede — tente de novo."); }
  }

  return (
    <div className="evaluate">
      <div className="cache-input evaluate-input">
        <span className="prefix">⌖</span>
        <input
          type="text" placeholder="Cole 1 ou 2 links (TikTok e Instagram juntos = mesma pessoa, separados por espaço)…"
          value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && evaluate()}
        />
      </div>
      <button className="gold-btn evaluate-btn" onClick={evaluate} disabled={st === "loading"}>
        {st === "loading" ? (msg || "Avaliando…") : "Avaliar perfil"}
      </button>
      {st === "error" && <div className="evaluate-msg">{msg}</div>}
    </div>
  );
}
