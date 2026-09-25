"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { r2 } from "@/lib/numeros";

/**
 * Botão de "Correr descoberta" no topo de /descobertas.
 *
 * Até jul/2026 nenhuma rota de descoberta estava ligada a um botão: a descoberta acontecia
 * quando alguém abria a URL da API à mão, o que se vê nos dados — a fonte tubular parou a
 * 12/06 e a caption-* só voltou a correr a 25/07. Um radar cuja entrada depende de alguém
 * se lembrar não é um radar.
 *
 * SÍNCRONO E PEQUENO, de propósito. A aplicação não tem mecanismo de polling nenhum, e um
 * job em segundo plano obrigaria a inventá-lo. Com tecto de ~200 creators a corrida cabe em
 * menos de um minuto e o operador vê o resultado — quantos entraram e quanta quota sobrou.
 *
 * O cron das 05:00 corre EXACTAMENTE estes parâmetros (todos os territórios, ambas as
 * plataformas, 200 nomes) sozinho, todos os dias. O botão é para quem não quer esperar por
 * ele, ou para varrer um território à parte.
 *
 * O "Verificar" chama a mesma rota com ?dry=1&sonda=1: além da estimativa de custo, pergunta
 * à Tubular quantos vídeos a janela devolve DE FACTO (campo `total` do v3) — 1 unidade por
 * consulta, contra as ~1.300 da corrida. É o que responde a "quantos registos vêm se eu
 * correr isto?", que uma estimativa por rendimento médio não responde. Como o throttle da
 * Tubular é serializado a 1,3s, a verificação de `todos` sem keyword (26 consultas) leva
 * ~40s — daí o aviso de espera no botão.
 */
const TERRITORIOS = [
  { v: "todos", label: "Todos os territórios" },
  { v: "beauty", label: "Beauty" },
  { v: "health", label: "Saúde" },
  { v: "lifestyle", label: "Lifestyle" },
];
const PLATAFORMAS = [
  { v: "ambas", label: "Ambas" },
  { v: "tiktok", label: "TikTok" },
  { v: "instagram", label: "Instagram" },
];
// A janela deixa de estar presa aos 3 dias. Os rótulos são períodos que um operador pede;
// os valores são o `?dias=` da rota (tecto 1825 = 5 anos). O cron das 05:00 continua nos 3
// dias — a janela curta é o modo renovável e barato; as longas repetem mais do que a base já
// tem, e as unidades pagam-se por vídeo devolvido mesmo quando o dedup deita fora. Nota para
// as janelas de anos: a ordenação por engagement devolve os maiores hits do período inteiro,
// portanto quanto mais longa a janela, mais o lote puxa para quem já estourou — a banda de
// seguidores corta os megas, mas o "Verificar" é ainda mais aconselhável antes de pagar.
const JANELAS = [
  { v: 1, label: "1 dia" },
  { v: 3, label: "3 dias" },
  { v: 7, label: "1 semana" },
  { v: 30, label: "1 mês" },
  { v: 90, label: "3 meses" },
  { v: 180, label: "6 meses" },
  { v: 365, label: "1 ano" },
  { v: 730, label: "2 anos" },
  { v: 1825, label: "5 anos" },
];
// O corte de views por vídeo estava fixo nos 20 mil — para um nicho apertado (uma keyword
// específica, uma janela de 1 dia) é alto demais e deixa o lote vazio. O ?minviews= da rota
// sempre existiu; ganha porta. 20 mil continua a ser a omissão, que é a do cron: baixar o
// corte alarga o lote e o custo, e o "Verificar" mostra quanto antes de pagar.
const VIEWS_MIN = [
  { v: 1000, label: "1 mil" },
  { v: 5000, label: "5 mil" },
  { v: 10000, label: "10 mil" },
  { v: 20000, label: "20 mil" },
  { v: 50000, label: "50 mil" },
  { v: 100000, label: "100 mil" },
];
// Tecto de creators novos por corrida. 1500 é o limite da ROTA, não um capricho: a corrida é
// síncrona e tem de caber nos 300s da função — acima disso o corte de tempo interno trava a
// descoberta a meio e grava o que houver. O custo cresce junto (~1,5 vídeos pedidos por nome,
// a 1 unidade cada): 200 ≈ 1.300 unidades em "todos", 1500 ≈ 4.700. O cron fica nos 200.
// Acima de 1500 a corrida vira CADEIA: elos de 1500 conduzidos PELO BROWSER (o servidor não
// pode auto-encadear — a Vercel corta auto-invocações à 5ª; ver o cabeçalho da rota), com os
// scroll tokens guardados para não repagar páginas. O separador tem de ficar aberto; fechar
// pausa e o clique com os mesmos parâmetros retoma do elo gravado.
const TECTOS = [
  { v: 200, label: "200" },
  { v: 500, label: "500" },
  { v: 1000, label: "1000" },
  { v: 1500, label: "1500" },
  { v: 5000, label: "5000 (em cadeia)" },
  { v: 15000, label: "15000 (em cadeia)" },
];

export default function DiscoveryRunner() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [territorio, setTerritorio] = useState("todos");
  const [plataforma, setPlataforma] = useState("ambas");
  const [dias, setDias] = useState(3);
  const [minViews, setMinViews] = useState(20000);
  const [tecto, setTecto] = useState(200);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(null); // "dry" | "run"
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  const correr = async (dry) => {
    setBusy(dry ? "dry" : "run"); setErr(null); setRes(null);
    try {
      const kw = keyword.trim();
      const base = `/api/discover-tubular?territorio=${territorio}&plataforma=${plataforma}&max=${tecto}&dias=${dias}&minviews=${minViews}` +
        (kw ? `&keyword=${encodeURIComponent(kw)}` : "");
      let j = await (await fetch(base + (dry ? "&dry=1&sonda=1" : ""), { method: "POST", cache: "no-store" })).json();

      // A CADEIA É CONDUZIDA DAQUI, elo a elo. O servidor não pode auto-encadear — a Vercel
      // corta a linhagem de auto-invocações à 5ª (duas cadeias mortas no elo 6 a 30/07, com
      // o pedido a nunca chegar ao edge) — mas cada pedido do browser nasce sem linhagem.
      // O resultado parcial vai para o ecrã entre elos; fechar o separador pausa, e o clique
      // com os mesmos parâmetros retoma do elo gravado.
      let elosNesteClique = 0;
      while (!dry && j?.cadeia?.continua && j.cadeia.proximo_elo && !j.error && !j.fatal && elosNesteClique < 12) {
        setRes(j);
        elosNesteClique++;
        j = await (await fetch(`${base}&elo=${j.cadeia.proximo_elo}`, { method: "POST", cache: "no-store" })).json();
      }

      if (j.error || j.fatal) setErr(j.error || j.fatal);
      else { setRes(j); if (!dry) router.refresh(); }
    } catch (e) {
      setErr(String(e).slice(0, 200));
    } finally { setBusy(null); }
  };

  return (
    <div className="disc-runner">
      <button type="button" className={`chip${aberto ? " aberto" : ""}`} onClick={() => setAberto((v) => !v)}>
        {aberto ? "▾" : "▸"} Descoberta A · por conteúdo (vídeos)
      </button>

      {aberto && (
        <div className="disc-runner-box">
          <div className="disc-runner-row">
            <label className="filter-group">
              <span className="filter-label">Território</span>
              <select className="filter-select" value={territorio} disabled={!!busy}
                onChange={(e) => setTerritorio(e.target.value)}>
                {TERRITORIOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Plataforma</span>
              <select className="filter-select" value={plataforma} disabled={!!busy}
                onChange={(e) => setPlataforma(e.target.value)}>
                {PLATAFORMAS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Janela</span>
              <select className="filter-select" value={dias} disabled={!!busy}
                onChange={(e) => setDias(Number(e.target.value))}>
                {JANELAS.map((j) => <option key={j.v} value={j.v}>{j.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Views mín.</span>
              <select className="filter-select" value={minViews} disabled={!!busy}
                onChange={(e) => setMinViews(Number(e.target.value))}>
                {VIEWS_MIN.map((v) => <option key={v.v} value={v.v}>{v.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Tecto</span>
              <select className="filter-select" value={tecto} disabled={!!busy}
                onChange={(e) => setTecto(Number(e.target.value))}>
                {TECTOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Keyword (opcional)</span>
              {/* sem minWidth inline: a largura é do CSS da barra (o campo é quem cede
                  espaço para a linha ficar inteira) */}
              <input className="rl-search" placeholder="ex.: minoxidil"
                value={keyword} disabled={!!busy} maxLength={80}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") correr(true); }} />
            </label>
            <button type="button" className="chip" disabled={!!busy} onClick={() => correr(true)}
              title="Pergunta à Tubular quantos vídeos esta janela devolve antes de correr — custa 1 unidade por consulta; com todos os territórios sem keyword leva ~40s">
              {busy === "dry" ? "A verificar…" : "Verificar na Tubular"}
            </button>
            <button type="button" className="gold-btn" disabled={!!busy} onClick={() => correr(false)}>
              {busy === "run" ? "A descobrir…" : "Correr agora"}
            </button>
          </div>

          <div className="disc-runner-hint">
            Brasil · creators (não marcas) · vídeos da janela escolhida acima do mínimo de views,
            por ordem de engagement. Com keyword, procura só esse termo (o território continua a
            valer para género e banda de seguidores). O tecto é o máximo de nomes novos gravados —
            até 1500 a corrida é síncrona (2–3 min); 5000 e 15000 correm em cadeia de elos, com o
            progresso à vista — mantém o separador aberto; fechar pausa e correr outra vez com os
            mesmos parâmetros retoma. O cron
            das 05:00 corre todos os dias com 200, janela de 3 dias, 20 mil views —
            alargar a janela ou baixar as views encontra mais, mas repete mais do que a base já
            tem e paga por vídeo devolvido.
          </div>

          {err && <div className="disc-runner-err">{err}</div>}

          {res?.dry && (
            <div className="disc-runner-res">
              {/* a contagem REAL primeiro — é ela que decide se vale correr; o custo vem depois */}
              {res.sonda && !res.sonda.erro && (
                <>
                  <b>{res.sonda.total_videos_na_janela.toLocaleString("pt-BR")} vídeos</b> na janela
                  {res.janela ? ` (${res.janela.desde} → ${res.janela.ate})` : ""} ·
                  {" "}a corrida pede <b>{res.sonda.videos_que_a_corrida_pede}</b> deles ·
                  {" "}~<b>{res.sonda.creators_estimados_antes_do_dedup} creators</b> antes do dedup e da banda de seguidores
                  {res.sonda.consultas?.length > 1 && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: "pointer", opacity: 0.75 }}>por consulta ({res.sonda.consultas.length})</summary>
                      {res.sonda.consultas.map((s, i) => (
                        <div key={i} style={{ opacity: 0.85 }}>
                          {s.territorio} · {s.plataforma} · {s.termo}: {s.erro
                            ? <span style={{ color: "var(--red)" }}>{s.erro}</span>
                            : <b>{(s.videos_na_janela ?? 0).toLocaleString("pt-BR")}</b>}
                        </div>
                      ))}
                    </details>
                  )}
                  <br />
                </>
              )}
              {res.sonda?.erro && <><span style={{ color: "var(--red)" }}>{res.sonda.erro}</span><br /></>}
              Custo estimado da corrida <b>{res.custo_estimado_unidades} unidades</b>
              {res.sonda?.custo_da_sonda_unidades ? ` (verificação: ${res.sonda.custo_da_sonda_unidades})` : ""} ·
              {" "}saldo Tubular <b>{r2(res.sonda?.saldo_apos_sonda ?? res.saldo_tubular) ?? "—"}</b>
              {res.expira ? ` (repõe em ${res.expira})` : ""} · piso {res.piso}
              <br />
              Vídeos únicos: pede <b>{res.videos_unicos_pedidos}</b> de{" "}
              <b>{res.videos_unicos_saldo ?? "—"}</b> disponíveis · piso {res.videos_unicos_piso}
              {res.videos_unicos_expira ? ` · expira ${res.videos_unicos_expira}` : ""}
              {res.bloqueado_por ? <><br /><span style={{ color: "var(--red)" }}>{res.bloqueado_por}</span></> : ""}
            </div>
          )}

          {res && !res.dry && (
            <div className="disc-runner-res">
              <b>{res.gravados}</b> novos prospects
              {res.por_territorio && Object.keys(res.por_territorio).length
                ? " — " + Object.entries(res.por_territorio).map(([t, n]) => `${t} ${n}`).join(", ")
                : ` em ${res.territorio}`}
              <br />
              {/* o funil inteiro, com CADA corte nomeado. "382 descobertos → 119 gravados"
                  sem os passos do meio é a pergunta "porquê tão poucos?" garantida — e a
                  resposta já vinha na API, só não estava no ecrã. */}
              {res.descobertos} descobertos
              {res.ja_na_base != null && res.ja_na_base > 0 ? ` → ${res.ja_na_base} já na base` : ""}
              {res.ineditos_totais != null ? ` → ${res.ineditos_totais} inéditos` : ""}
              {res.ineditos_totais != null && res.novos_apos_dedup < res.ineditos_totais ? ` → tecto de ${res.novos_apos_dedup}` : ""}
              {" "}→ {res.graduados} graduados
              {res.descartados && (res.descartados.sem_metricas + res.descartados.fora_da_faixa + res.descartados.inactivos) > 0 && (
                <> → descartados: {[
                  res.descartados.fora_da_faixa ? `${res.descartados.fora_da_faixa} fora da banda 3k–500k` : null,
                  res.descartados.sem_metricas ? `${res.descartados.sem_metricas} sem métricas` : null,
                  res.descartados.inactivos ? `${res.descartados.inactivos} inativos` : null,
                ].filter(Boolean).join(", ")}</>
              )}
              {" "}→ <b>{res.gravados} gravados</b>
              <br />
              {res.chamadas_tubular} chamadas, ~{res.custo_real_estimado ?? "?"} unidades ·
              {" "}saldo <b>{r2(res.saldo_tubular) ?? "—"}</b>
              {res.cadeia && <>
                <br />
                {res.cadeia.continua
                  ? <><b>Cadeia em curso</b> — elo {res.cadeia.elo} feito, {res.cadeia.gravados_acumulados} de {res.cadeia.alvo} acumulados.
                      O elo {res.cadeia.proximo_elo} está a correr — <b>mantém este separador aberto</b>; fechar pausa, e correr
                      outra vez com os mesmos parâmetros retoma daqui.</>
                  : <><b>Cadeia terminada</b> no elo {res.cadeia.elo} com {res.cadeia.gravados_acumulados} de {res.cadeia.alvo} — {res.cadeia.motivo}.</>}
              </>}
              {res.gravados > 0 && <>
                <br />
                {/* O link é o que fecha o ciclo: sem ele, "83 novos prospects" é um número que
                    o operador não consegue transformar em 83 cartões — entram ordenados por
                    mérito no meio de 40 mil linhas. */}
                <a href="/descobertas?desde=1" className="disc-runner-link">Ver as descobertas de hoje →</a>
                {" · "}entram sem @, correr <code>/api/resolve-handles</code> para os tornar promovíveis.
              </>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
