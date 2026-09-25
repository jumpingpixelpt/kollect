"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { marcarEnriquecimento } from "@/lib/enrich-status";
import { mensagemErro } from "@/lib/erro-cliente";

// O botão dizia "Atualizado ✓" sempre que a resposta trazia `enriquecimento`, mesmo que
// os 12 passos lá dentro tivessem falhado todos — que foi exactamente o que aconteceu
// quando as chamadas internas começaram a levar 401: página vazia, botão verde. Agora
// lê o resumo e só assina sucesso quando algum passo correu mesmo.
export default function EnrichButton({ handle, creatorId, auto = false }) {
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  const arrancou = useRef(false);

  async function run() {
    setSt("running"); setMsg("");
    marcarEnriquecimento(true); // põe os painéis vazios da ficha em "a processar"
    try {
      // completo=1: quem abre um perfil e carrega aqui quer a análise de conteúdo, mesmo que
      // o creator não passe o corte do Score KOL que a cadeia aplica às promoções em lote.
      const r = await fetch(`/api/enrich?handle=${encodeURIComponent(handle)}&completo=1`);
      const j = await r.json();
      const ok = j.resumo?.ok ?? 0;
      const falhas = j.resumo?.falhas ?? 0;

      if (j.fatal || (j.resumo && ok === 0)) {
        setSt("error");
        setMsg(mensagemErro(j, "A atualização não correu agora. Tente de novo em alguns minutos."));
        return;
      }
      setSt("done");
      if (falhas > 0) setMsg(`${falhas} de ${j.resumo.passos} passos falharam — dados parciais`);
      router.refresh();
      setTimeout(() => { setSt("idle"); setMsg(""); }, 4000);
    } catch { setSt("error"); setMsg("falha de rede"); }
    // finally, e não no fim do try: há um `return` antecipado no ramo do erro, e sem isto
    // os painéis ficariam a girar para sempre depois de a cadeia falhar.
    finally { marcarEnriquecimento(false); }
  }

  // `auto` vem do ?novo=1 que a importação por link põe no URL: a primeira análise arranca
  // sozinha ao aterrar na ficha, em vez de ser disparada pelo EvaluateBar e perdida de vista.
  //
  // A guarda tem de ser sessionStorage e não só a ref. O run() acaba em router.refresh(),
  // que re-busca o payload RSC do URL DO ROUTER — e esse continua com ?novo=1, porque o
  // replaceState abaixo só mexe na barra de endereço do browser, não no estado do router.
  // A ficha voltava a renderizar com auto=true e, se o componente remontasse, a ref vinha
  // a false e a cadeia arrancava outra vez: mediram-se 3 chamadas a /api/enrich em 28
  // segundos para a mesma importação, três cadeias concorrentes a escrever por cima umas
  // das outras. A chave sobrevive a remontagens dentro do separador.
  //
  // Tem de ser o ID e não o handle: reimportar o mesmo perfil cria uma linha nova, com id
  // novo, mas o handle é o mesmo. Chaveada pelo handle, a marca deixada por uma importação
  // anterior bloqueava em silêncio o arranque da seguinte no mesmo separador — a ficha
  // ficava com os vídeos do evaluate e mais nada, à espera de um clique que ninguém sabia
  // ser preciso.
  useEffect(() => {
    if (!auto || arrancou.current) return;
    const chave = `kollect:enrich-auto:${creatorId || handle}`;
    try {
      if (sessionStorage.getItem(chave)) { arrancou.current = true; return; }
      sessionStorage.setItem(chave, "1");
    } catch {}
    arrancou.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("novo");
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch {}
    run();
  }, [auto, creatorId, handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const primeira = auto && st === "running";
  return (
    <>
      <button className="ghost-btn crm-btn" onClick={run} disabled={st === "running"} style={{ marginLeft: 10 }}>
        {primeira ? "Primeira análise… (~3 min)" : st === "running" ? "Atualizando… (~3 min)" : st === "done" ? "Atualizado ✓" : st === "error" ? "Erro — tente de novo" : "↻ Atualizar dados"}
      </button>
      {msg && (
        <span className="formula-note" style={{ marginLeft: 10, color: st === "error" ? "var(--red)" : "var(--text-dim)" }}>{msg}</span>
      )}
    </>
  );
}
