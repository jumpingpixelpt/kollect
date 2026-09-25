"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AvatarImg from "./AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";
import { motivoDaFalha } from "@/lib/promote-error";
import { mensagemErro } from "@/lib/erro-cliente";
import s from "./HubBuscaExtra.module.css";

/**
 * O que a busca do Creators Hub acha FORA da lista analisada (feedback rodada 2, F3.2).
 *
 * Três blocos, por baixo da lista principal, só quando há texto (≥ 2 caracteres):
 *
 *  1. «Sem análise completa» — creators que existem na base mas ainda não têm score, e por
 *     isso não entram na vista `leaderboard` de onde a lista sai. Link para a ficha.
 *  2. «Na base de descoberta · ainda não analisados» — prospects (a base de ~68 mil) que
 *     casam pelo nome ou @, com o botão «Analisar»: promove o prospect pelo /api/promote
 *     (o mesmo da Descoberta; Apify por plataforma) e abre a ficha. Aberto a qualquer
 *     sessão: custa o mesmo que o «Avaliar perfil pelo link», que o operador já tinha.
 *  3. «Procurar fora da KOLLECT» — quando nada acima achou o nome (ou, para um texto começado
 *     por @, quando nenhum perfil tem esse @ exacto), e só a clique: pergunta
 *     à Tubular (/api/hub-busca-externa, gasta quota) e oferece «Trazer para a KOLLECT»,
 *     que é o /api/evaluate do «Avaliar perfil pelo link».
 *
 * `total` é o número de acertos da lista principal e `temExato` diz se algum deles tem o @
 * escrito; os dois decidem se o botão externo aparece.
 */
const DEBOUNCE_MS = 400;
const fmt = (n) => (n == null ? "—" : Number(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} M` : Number(n) >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));
const REDE = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

export default function HubBuscaExtra({ q = "", total = 0, filtering = false, temExato = false }) {
  const t = q.trim();
  const [res, setRes] = useState({ q: "", sem_score: [], prospects: [] });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [ext, setExt] = useState(null); // { q, estado: "a_procurar"|"ok"|"erro", resultados, msg }
  const reqId = useRef(0);

  useEffect(() => {
    setExt(null);
    if (t.replace(/^@+/, "").length < 2) { setRes({ q: "", sem_score: [], prospects: [] }); setErro(null); return; }
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setCarregando(true); setErro(null);
      try {
        const r = await fetch(`/api/hub-busca?q=${encodeURIComponent(t)}`, { signal: ctrl.signal }).then((x) => x.json());
        if (id !== reqId.current) return;
        if (r.error) { setErro(mensagemErro(r)); setRes({ q: t, sem_score: [], prospects: [] }); return; }
        setRes({ q: t, sem_score: r.sem_score ?? [], prospects: r.prospects ?? [] });
      } catch (e) {
        if (e?.name !== "AbortError" && id === reqId.current) setErro("Falha de rede.");
      } finally {
        if (id === reqId.current) setCarregando(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [t]);

  if (!t || t.replace(/^@+/, "").length < 2) return null;

  // O botão externo aparece quando nada casou — ou, para um @ escrito como tal, quando nada
  // casou EXACTAMENTE: «@camilacoelho» achava a @camilacoelhomoraes e escondia o botão.
  const hAlvo = t.startsWith("@") ? t.replace(/^@+/, "").toLowerCase() : null;
  const exatoNaBase = temExato || [...res.sem_score, ...res.prospects].some((c) => String(c.handle || "").toLowerCase() === hAlvo);
  const pronto = !filtering && !carregando && !erro && res.q === t;
  const nadaNaBase = pronto && (hAlvo
    ? !exatoNaBase
    : total === 0 && !res.sem_score.length && !res.prospects.length);

  async function procurarFora() {
    setExt({ q: t, estado: "a_procurar", resultados: [] });
    try {
      const r = await fetch(`/api/hub-busca-externa?q=${encodeURIComponent(t)}`).then((x) => x.json());
      if (r.error) { setExt({ q: t, estado: "erro", resultados: [], msg: mensagemErro(r) }); return; }
      setExt({ q: t, estado: "ok", resultados: r.resultados ?? [] });
    } catch { setExt({ q: t, estado: "erro", resultados: [], msg: "Falha de rede — tente de novo." }); }
  }

  return (
    <div className={s.extra}>
      {erro && <p className={s.nota}>Não deu para procurar na base de descoberta ({erro}).</p>}

      {res.sem_score.length > 0 && (
        <section className={s.bloco}>
          <h3 className={s.titulo}>Na base · sem análise completa</h3>
          <p className={s.nota}>Estes perfis já entraram na KOLLECT mas ainda não têm o score calculado, por isso não aparecem na lista acima.</p>
          <ul className={s.lista}>
            {res.sem_score.map((c) => (
              <li key={c.id} className={s.linha}>
                <AvatarImg src={avatarSrc(c.avatar_url, c.id)} nome={c.name || c.handle} size={36} className={s.avatar} classeInicial={s.inicial} />
                <div className={s.quem}>
                  <Link href={`/creator/${c.id}`} className={s.nome}>{c.name || `@${c.handle}`}</Link>
                  <span className={s.meta}>@{c.handle} · {REDE[c.platform] ?? c.platform} · {fmt(c.followers)} seguidores</span>
                </div>
                <span className="tag">sem análise completa</span>
                <Link href={`/creator/${c.id}`} className="chip">Abrir ficha →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {res.prospects.length > 0 && (
        <section className={s.bloco}>
          <h3 className={s.titulo}>Na base de descoberta · ainda não analisados</h3>
          <p className={s.nota}>Perfis que a KOLLECT já encontrou mas ainda não analisou. «Analisar» importa o perfil com as métricas e abre a ficha (leva alguns minutos).</p>
          <ul className={s.lista}>
            {res.prospects.map((p) => <LinhaProspect key={p.tubular_id} p={p} />)}
          </ul>
        </section>
      )}

      {nadaNaBase && !ext && (
        <section className={s.bloco}>
          <p className={s.nota}>{hAlvo && (total > 0 || res.sem_score.length || res.prospects.length)
            ? <>Nenhum perfil com o @ exacto <b>{t}</b> na KOLLECT — só parecidos.</>
            : <>Nada na KOLLECT com <b>“{t}”</b>, nem na base de descoberta.</>}</p>
          <button className="gold-btn" onClick={procurarFora}>Procurar fora da KOLLECT</button>
        </section>
      )}

      {ext && ext.q === t && (
        <section className={s.bloco}>
          <h3 className={s.titulo}>Fora da KOLLECT</h3>
          {ext.estado === "a_procurar" && <p className={s.nota}>A procurar <b>“{t}”</b> fora da KOLLECT… pode levar alguns segundos.</p>}
          {ext.estado === "erro" && <p className={s.nota}>{ext.msg}</p>}
          {ext.estado === "ok" && !ext.resultados.length && <p className={s.nota}>Nenhum perfil brasileiro encontrado com <b>“{t}”</b>. Se tiver o link do perfil, use «Avaliar um perfil pelo link», mais abaixo.</p>}
          {ext.estado === "ok" && ext.resultados.length > 0 && (
            <ul className={s.lista}>
              {ext.resultados.map((r) => <LinhaExterna key={r.tubular_id} r={r} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function LinhaProspect({ p }) {
  const router = useRouter();
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");

  async function analisar() {
    setSt("running"); setMsg("");
    try {
      const j = await fetch(`/api/promote?tubular_id=${encodeURIComponent(p.tubular_id)}`).then((r) => r.json());
      // formato do promote-apify/tiktok (objeto directo) ou do caminho antigo (detalhes[])
      const ok = (j?.ok && j?.creator_id) ? j : j?.detalhes?.find((d) => d.ok);
      if (ok?.creator_id) {
        setSt("done");
        // o promote-apify já correu a cadeia de enriquecimento; o do TikTok não — aí é a
        // ficha que a dispara (?novo=1, o mesmo caminho do «Avaliar perfil pelo link»)
        router.push(`/creator/${ok.creator_id}${j?.enrich ? "" : "?novo=1"}`);
        return;
      }
      setSt("error");
      setMsg(mensagemErro({ error: motivoDaFalha(j) }, "Não foi possível analisar este perfil agora."));
    } catch { setSt("error"); setMsg("Erro de rede ou tempo esgotado — tente de novo."); }
  }

  return (
    <li className={s.linha}>
      <AvatarImg src={avatarSrc(p.thumbnail)} nome={p.name || p.handle} size={36} className={s.avatar} classeInicial={s.inicial} />
      <div className={s.quem}>
        <span className={s.nome}>{p.name || `@${p.handle}`}</span>
        <span className={s.meta}>@{p.handle} · {REDE[p.platform] ?? p.platform ?? "—"} · {fmt(p.followers)} seguidores{p.genre ? ` · ${p.genre}` : ""}</span>
        {msg && <span className={s.erro}>{msg}</span>}
      </div>
      <button className="gold-btn" onClick={analisar} disabled={st === "running" || st === "done"} style={{ whiteSpace: "nowrap" }}>
        {st === "running" ? "Analisando… (alguns min)" : st === "done" ? "A abrir a ficha…" : st === "error" ? "Tentar de novo" : "Analisar"}
      </button>
    </li>
  );
}

function LinhaExterna({ r }) {
  const router = useRouter();
  const [st, setSt] = useState("idle");
  const [msg, setMsg] = useState("");
  const conta = r.contas[0];

  async function trazer() {
    setSt("running"); setMsg("");
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: conta.url }),
      });
      const j = await res.json();
      if (res.ok && j?.id) { setSt("done"); router.push(`/creator/${j.id}?novo=1`); return; }
      setSt("error"); setMsg(mensagemErro(j, "Não foi possível importar este perfil agora."));
    } catch { setSt("error"); setMsg("Erro de rede — tente de novo."); }
  }

  return (
    <li className={s.linha}>
      <AvatarImg src={avatarSrc(r.thumbnail)} nome={r.name} size={36} className={s.avatar} classeInicial={s.inicial} />
      <div className={s.quem}>
        <span className={s.nome}>{r.name}</span>
        <span className={s.meta}>
          {r.contas.map((c) => `@${c.handle} · ${REDE[c.platform]} · ${fmt(c.followers)}`).join("  |  ")}
        </span>
        {msg && <span className={s.erro}>{msg}</span>}
      </div>
      {r.creator_id
        ? <Link href={`/creator/${r.creator_id}`} className="chip">Já está na KOLLECT →</Link>
        : (
          <button className="gold-btn" onClick={trazer} disabled={st === "running" || st === "done"} style={{ whiteSpace: "nowrap" }}>
            {st === "running" ? "Importando…" : st === "done" ? "A abrir a ficha…" : st === "error" ? "Tentar de novo" : "Trazer para a KOLLECT"}
          </button>
        )}
    </li>
  );
}
