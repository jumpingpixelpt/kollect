"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import BuscaCreators from "./BuscaCreators";
import RadarListing from "./RadarListing";
import HubBuscaExtra from "./HubBuscaExtra";
import { mensagemErro } from "@/lib/erro-cliente";

/**
 * O Creators Hub no cliente: a barra de busca (BuscaCreators), a lista (RadarListing) e
 * o scroll infinito. Recebe a 1ª fatia do SSR e vai buscando as seguintes a
 * /api/creators-list quando a sentinela entra no viewport.
 *
 * TODOS os filtros moram aqui — busca, tema, tier, creator's topic, território,
 * classificação, plataforma, marca, ordenação por coluna — e cada mudança refaz o pedido ao servidor a
 * partir do offset 0, recebendo o recorte inteiro: creators, total e ordem. Antes,
 * território/classificação/plataforma/marca eram parâmetros de URL que navegavam a página
 * (SSR) e remontavam este componente, levando com eles a busca escrita; a faixa e o tipo
 * eram estado daqui. Uma barra só, um estado só.
 *
 * A URL acompanha o estado (history.replaceState — sem navegar, sem SSR): o recorte é
 * partilhável, sobrevive ao refresh e ao "voltar", e a 1ª fatia do SSR já vem com ele.
 */
const DEBOUNCE_MS = 300;
// filtros da barra; `fw` (faixas antigas de seguidores) continua aqui para os links antigos,
// mas a barra só o mostra quando vem preenchido — o Tier tomou-lhe o lugar (set/2026)
const CHAVES = ["tier", "sn", "n", "l", "p", "fw", "b"];
const PASSA = ["c", "cs", "ft"];           // recortes só por URL: casting de campanha, formato

export default function CreatorsInfinite({ initial = [], total: total0 = 0, pageSize = 20, filtros = {}, tema0 = null, brands = [], topics = [], lists = [], campaigns = [], tags = [], podeApagar = false }) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(total0);
  const [loading, setLoading] = useState(false);   // a puxar mais uma fatia
  const [filtering, setFiltering] = useState(false); // a refazer o recorte
  const [erro, setErro] = useState(null);

  // `q` responde a cada tecla; o pedido só sai quando a pessoa pára de escrever.
  // `tema` é o segundo tempo da busca (Enter/Buscar) e cai assim que o texto muda.
  const [q, setQ] = useState(filtros.q || "");
  const [tema, setTema] = useState(filtros.tema === "1" && !!(filtros.q || "").trim());
  const [temaInfo, setTemaInfo] = useState(tema0);
  const [tick, setTick] = useState(0); // Enter outra vez com o mesmo texto = repetir a busca por tema
  const [f, setF] = useState(() => Object.fromEntries(CHAVES.map((k) => [k, filtros[k] || null])));
  const [sort, setSort] = useState(() => (filtros.sort ? { key: filtros.sort, dir: filtros.dir === "asc" ? "asc" : "desc" } : null));

  const ref = useRef(null);
  const topo = useRef(null);
  const busy = useRef(false);
  const reqId = useRef(0);        // descarta respostas de pedidos ultrapassados
  const firstRun = useRef(true);
  const digitou = useRef(false);  // a última mudança foi uma tecla → espera-se que pare

  const done = items.length >= total;

  const params = useCallback((extra) => {
    const qs = new URLSearchParams();
    const t = q.trim();
    if (t) qs.set("q", t);
    if (t && tema) qs.set("tema", "1");
    for (const k of CHAVES) if (f[k]) qs.set(k, f[k]);
    if (sort) { qs.set("sort", sort.key); qs.set("dir", sort.dir); }
    for (const k of PASSA) if (filtros[k]) qs.set(k, filtros[k]);
    for (const [k, v] of Object.entries(extra || {})) qs.set(k, String(v));
    return qs;
  }, [q, tema, f, sort, filtros]);

  // ── refazer o recorte quando um filtro muda (offset 0, substitui a lista) ──
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; } // o SSR já trouxe a 1ª fatia
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const run = async () => {
      setFiltering(true);
      setErro(null);
      try {
        const r = await fetch(`/api/creators-list?${params({ offset: 0, limit: pageSize })}`, { signal: ctrl.signal }).then((x) => x.json());
        if (id !== reqId.current) return; // chegou tarde: outro filtro já mandou
        if (r.error) { setErro(mensagemErro(r)); return; }
        busy.current = false;
        setItems(Array.isArray(r.items) ? r.items : []);
        setTotal(Number(r.total) || 0);
        setTemaInfo(r.tema ?? null);
        // recorte novo, lista nova: quem estava a meio do scroll ficava a olhar
        // para o vazio por baixo de meia dúzia de cards
        if (topo.current && topo.current.getBoundingClientRect().top < 0) {
          topo.current.scrollIntoView({ block: "start" });
        }
      } catch (e) {
        if (e?.name !== "AbortError" && id === reqId.current) setErro("Falha de rede.");
      } finally {
        if (id === reqId.current) setFiltering(false);
      }
    };
    // escrever é a única interação por tecla: os selects, o Enter e a ordenação disparam já
    const wait = digitou.current ? DEBOUNCE_MS : 0;
    digitou.current = false;
    const t = setTimeout(run, wait);
    return () => { clearTimeout(t); ctrl.abort(); }; // tecla nova cancela o pedido a meio
  }, [q, tema, tick, f, sort, params, pageSize]);

  // ── espelho na URL, sem navegar (o Next 14.1+ integra o replaceState nativo no router) ──
  useEffect(() => {
    if (firstRun.current) return; // a URL de entrada já é o estado
    // (as abas Top Conteúdos / Mood Board saíram do Hub em set/2026 e foram para a ficha;
    // já não há `aba`/`creator` a preservar aqui)
    const s = params({}).toString();
    const alvo = `${window.location.pathname}${s ? `?${s}` : ""}`;
    if (alvo !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", alvo);
  }, [params]);

  const onQ = (v) => { digitou.current = true; setTema(false); setQ(v); };
  // Enter / botão Buscar: além dos acertos por nome e categoria, o tema no conteúdo
  const buscarTema = () => {
    if (!q.trim()) return;
    digitou.current = false;
    setTemaInfo(null);
    setTema(true);
    setTick((x) => x + 1);
  };
  const onF = (patch) => { digitou.current = false; setF((prev) => ({ ...prev, ...patch })); };
  const temFiltros = CHAVES.some((k) => !!f[k]);

  // ── fatia seguinte do mesmo recorte ──
  const loadMore = async (limit) => {
    if (busy.current || filtering || items.length >= total) return;
    busy.current = true;
    setLoading(true);
    const id = reqId.current;
    try {
      const r = await fetch(`/api/creators-list?${params({ offset: items.length, limit: limit || pageSize })}`).then((x) => x.json());
      if (id !== reqId.current) return; // um filtro mudou entretanto: a fatia é de outro recorte
      if (r.error) { setErro(mensagemErro(r)); return; } // erro trava a sentinela até haver um clique
      if (Array.isArray(r.items) && r.items.length) {
        setItems((prev) => [...prev, ...r.items]);
        if (Number.isFinite(Number(r.total))) setTotal(Number(r.total));
      } else {
        setTotal(items.length); // resposta vazia: é mesmo o fim, não uma pausa
      }
    } catch {
      setErro("Falha de rede.");
    } finally {
      setLoading(false);
      busy.current = false;
    }
  };

  const limparFiltros = () => {
    digitou.current = false;
    setQ(""); setTema(false); setTemaInfo(null); setSort(null);
    setF(Object.fromEntries(CHAVES.map((k) => [k, null])));
  };

  // ── recarregar após uma mutação (apagar creators) ──
  // O recorte em memória e o cache de processo do servidor ainda têm os apagados;
  // pede-se o offset 0 com fresh=1 (salta o cache) e substitui-se a lista inteira.
  const recarregar = async () => {
    const id = ++reqId.current;
    setFiltering(true); setErro(null);
    try {
      const r = await fetch(`/api/creators-list?${params({ offset: 0, limit: Math.max(items.length, pageSize), fresh: 1 })}`).then((x) => x.json());
      if (id !== reqId.current) return;
      if (r.error) { setErro(mensagemErro(r)); return; }
      busy.current = false;
      setItems(Array.isArray(r.items) ? r.items : []);
      setTotal(Number(r.total) || 0);
      setTemaInfo(r.tema ?? null);
    } catch {
      if (id === reqId.current) setErro("Falha de rede.");
    } finally {
      if (id === reqId.current) setFiltering(false);
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el || done || filtering || erro || !total) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, total, done, filtering, erro]); // eslint-disable-line react-hooks/exhaustive-deps

  // O rodapé só fala quando tem o que dizer. Com a busca sem resultados dizia
  // "0 creators — fim da lista" por baixo de um "Nenhum creator nesse recorte", e
  // a cada tecla trocava para "A refazer o recorte…" e de volta: um pisca-pisca
  // debaixo de uma lista vazia. Quem conta a busca é a barra, em cima.
  const rodape = !erro && total > 0 && !filtering;

  return (
    <>
      <div ref={topo} />
      <BuscaCreators q={q} onQ={onQ} onBuscar={buscarTema} filtering={filtering} tema={tema} temaInfo={temaInfo}
        f={f} onF={onF} brands={brands} topics={topics} />
      <RadarListing
        creators={items} lists={lists} campaigns={campaigns} tags={tags} podeApagar={podeApagar}
        q={q} temFiltros={temFiltros} sort={sort} onSort={setSort} total={total} filtering={filtering}
        onLimpar={limparFiltros} onMutate={recarregar}
      />
      {/* altura fixa: sem ela, aparecer e desaparecer dava um salto na página */}
      <div ref={ref} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, minHeight: 64, color: "var(--text-faint, #888)", fontSize: 13 }}>
        {erro ? (
          <span>Não deu pra carregar mais ({erro}) · <button className="chip" onClick={() => setErro(null)} style={{ cursor: "pointer" }}>tentar de novo</button></span>
        ) : !rodape ? null : done ? (
          <span>{total.toLocaleString("pt-BR")} creator{total === 1 ? "" : "s"} — fim da lista.</span>
        ) : (
          // Nada de trocar texto entre páginas: a cada fatia isto alternava entre
          // "A carregar mais…" e a linha de botões, e a descer a lista lia-se como
          // um pisca-pisca. O contador sobe, o spinner acende, o resto fica quieto.
          <>
            {/* «20 de 5.209 creators · Carregar mais 20», como na lista do briefing (ListaCasting):
                o scroll continua a puxar sozinho; o botão é o caminho acessível e o de sempre */}
            <span aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>{items.length.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")} creators</span>
            <span className="pendente-spin" style={{ marginTop: 0, opacity: loading ? 1 : 0, transition: "opacity .15s" }} />
            <button className="chip" onClick={() => loadMore()} disabled={loading} aria-busy={loading || undefined} style={{ cursor: "pointer" }}>Carregar mais {Math.min(pageSize, total - items.length).toLocaleString("pt-BR")}</button>
            <button className="chip" onClick={() => loadMore(total - items.length)} style={{ cursor: "pointer" }}>Carregar tudo</button>
          </>
        )}
      </div>
      {/* F3.2 (rodada 2): o que a busca acha fora da lista analisada — creators sem score,
          a base de descoberta com «Analisar» e, sem nada, «Procurar fora da KOLLECT» */}
      <HubBuscaExtra q={q} total={total} filtering={filtering}
        temExato={temHandleExato(items, q)} />
    </>
  );
}

// «@fulana» com a @fulana já na lista: a busca fora da KOLLECT não tem de ser oferecida.
// Sem acerto exacto, oferece-se mesmo que a lista traga parecidos (@fulanamoraes).
function temHandleExato(items, q) {
  const h = String(q || "").trim().replace(/^@+/, "").toLowerCase();
  if (!h) return false;
  return items.some((c) => [c.handle, ...(c.accounts || []).map((a) => a.handle)].some((x) => String(x || "").toLowerCase() === h));
}
