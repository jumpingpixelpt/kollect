"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Descoberta B · por perfil — o painel do /api/discover-perfil.
 *
 * A Descoberta A (DiscoveryRunner) procura por CONTEÚDO: vídeos recentes sobre o
 * território, via v3/video.search, e paga vídeos únicos — o teto mensal que a importação
 * de cabelo de 03/09 esgotou até 01/10. Esta procura por PERFIL: quem é BR, do género, na
 * banda de seguidores e activo, via v4/creator.search, que só gasta unidades. Traz o @ na
 * própria resposta (account_snippet), portanto os prospects entram promovíveis, sem
 * resolve-handles.
 *
 * Mesmo desenho de cadeia da A: acima de 1000 o painel dispara elos de 1000 e mantém o
 * progresso à vista; fechar o separador pausa, o clique com os mesmos parâmetros retoma.
 */
const TERRITORIOS = [
  { v: "beauty", label: "Beauty" },
  { v: "health", label: "Saúde" },
  { v: "lifestyle", label: "Lifestyle" },
  { v: "todos", label: "Todos os territórios" },
];
const PLATAFORMAS = [
  { v: "ambas", label: "Ambas" },
  { v: "tiktok", label: "TikTok" },
  { v: "instagram", label: "Instagram" },
];
const ATIVOS = [
  { v: 7, label: "7 dias" },
  { v: 30, label: "30 dias" },
  { v: 90, label: "3 meses" },
  { v: 365, label: "1 ano" },
  { v: 0, label: "qualquer" },
];
// bandas de seguidores por PLATAFORMA (o filtro da Tubular soma as plataformas; a rota
// reverifica por conta). A omissão é a do território (3k–500k), como na A.
const BANDAS = [
  { v: "3000-500000", label: "3k – 500k" },
  { v: "3000-10000", label: "3k – 10k" },
  { v: "10000-50000", label: "10k – 50k" },
  { v: "50000-100000", label: "50k – 100k" },
  { v: "100000-500000", label: "100k – 500k" },
];
const ORDENS = [
  { v: "crescimento", label: "Crescimento 30d" },
  { v: "views", label: "Views mensais" },
  { v: "recente", label: "Post mais recente" },
];
const RISING = [
  { v: 0, label: "Todos" },
  { v: 1, label: "Só rising star" },
];
const TECTOS = [
  { v: 200, label: "200" },
  { v: 500, label: "500" },
  { v: 1000, label: "1000" },
  { v: 2500, label: "2500 (em cadeia)" },
  { v: 5000, label: "5000 (em cadeia)" },
  { v: 10000, label: "10000 (em cadeia)" },
];

export default function DiscoveryPerfilRunner() {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [territorio, setTerritorio] = useState("beauty");
  const [plataforma, setPlataforma] = useState("ambas");
  const [ativos, setAtivos] = useState(30);
  const [banda, setBanda] = useState("3000-500000");
  const [ordem, setOrdem] = useState("crescimento");
  const [rising, setRising] = useState(0);
  const [tecto, setTecto] = useState(200);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(null); // "dry" | "run"
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  const correr = async (dry) => {
    setBusy(dry ? "dry" : "run"); setErr(null); setRes(null);
    try {
      const kw = keyword.trim();
      const [fmin, fmax] = banda.split("-");
      const base = `/api/discover-perfil?territorio=${territorio}&plataforma=${plataforma}&max=${tecto}&ativos=${ativos}` +
        `&fmin=${fmin}&fmax=${fmax}&ordem=${ordem}${rising ? "&rising=1" : ""}` +
        (kw ? `&keyword=${encodeURIComponent(kw)}` : "");
      let j = await (await fetch(base + (dry ? "&dry=1" : ""), { method: "POST", cache: "no-store" })).json();

      // a cadeia é conduzida daqui, elo a elo — ver o cabeçalho do DiscoveryRunner
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

  const n = (v) => (v ?? 0).toLocaleString("pt-BR");

  return (
    <div className="disc-runner">
      <button type="button" className={`chip${aberto ? " aberto" : ""}`} onClick={() => setAberto((v) => !v)}>
        {aberto ? "▾" : "▸"} Descoberta B · por perfil (creators)
      </button>

      {aberto && (
        <div className="disc-runner-box">
          {/* duas linhas: oito selects numa (com quebra), keyword + botões noutra — numa só
              transbordavam para fora da caixa (ver .disc-runner-row.quebra no CSS) */}
          <div className="disc-runner-row quebra">
            <label className="filter-group">
              <span className="filter-label">Território</span>
              <select className="filter-select" value={territorio} disabled={!!busy} onChange={(e) => setTerritorio(e.target.value)}>
                {TERRITORIOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Plataforma</span>
              <select className="filter-select" value={plataforma} disabled={!!busy} onChange={(e) => setPlataforma(e.target.value)}>
                {PLATAFORMAS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Ativos há</span>
              <select className="filter-select" value={ativos} disabled={!!busy} onChange={(e) => setAtivos(Number(e.target.value))}>
                {ATIVOS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Seguidores</span>
              <select className="filter-select" value={banda} disabled={!!busy} onChange={(e) => setBanda(e.target.value)}>
                {BANDAS.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Ordem</span>
              <select className="filter-select" value={ordem} disabled={!!busy} onChange={(e) => setOrdem(e.target.value)}>
                {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Rising star</span>
              <select className="filter-select" value={rising} disabled={!!busy} onChange={(e) => setRising(Number(e.target.value))}>
                {RISING.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Tecto</span>
              <select className="filter-select" value={tecto} disabled={!!busy} onChange={(e) => setTecto(Number(e.target.value))}>
                {TECTOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div className="disc-runner-row">
            <label className="filter-group">
              <span className="filter-label">Keyword no perfil (opcional)</span>
              <input className="rl-search" placeholder="ex.: cabelo" value={keyword} disabled={!!busy} maxLength={80}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") correr(true); }} />
            </label>
            <button type="button" className="chip" disabled={!!busy} onClick={() => correr(true)}
              title="Conta quantos creators a Tubular tem com estes filtros — 5 unidades por consulta">
              {busy === "dry" ? "A verificar…" : "Verificar na Tubular"}
            </button>
            <button type="button" className="gold-btn" disabled={!!busy} onClick={() => correr(false)}>
              {busy === "run" ? "A descobrir…" : "Correr agora"}
            </button>
          </div>

          <div className="disc-runner-hint">
            Brasil · creators (não marcas) · por PERFIL, não por vídeo: quem é do género do território,
            na banda de seguidores, com post há menos do tempo escolhido. Só gasta unidades — não toca no
            teto de vídeos únicos que bloqueia a Descoberta A até ao início do mês. Traz o @ e a foto na
            própria resposta: os prospects entram promovíveis de imediato. Custa ~5 unidades por creator
            listado e ~20 por creator novo gravado. Com keyword, procura o termo no nome e na descrição do
            perfil (não no conteúdo). "Só rising star" é a marca da própria Tubular e é apertadíssima.
            O tecto é o máximo de novos gravados — até 1000 a corrida é síncrona; acima corre em cadeia
            de elos de 1000 com o progresso à vista — mantém o separador aberto; fechar pausa, correr
            outra vez com os mesmos parâmetros retoma.
          </div>

          {err && <div className="disc-runner-err">{err}</div>}

          {res?.dry && (
            <div className="disc-runner-res">
              {res.sonda && !res.sonda.erro && (
                <>
                  <b>{n(res.sonda.universo_somado)} creators</b> com estes filtros
                  {res.sonda.consultas?.length > 1 ? " (soma com sobreposição entre consultas)" : ""} ·
                  {" "}a corrida lista <b>{n(res.sonda.linhas_que_a_corrida_lista)}</b> e espera ~<b>{n(res.sonda.novos_esperados)} novos</b>
                  {" "}(rendimento de 20%, medido no topo — sobe nas páginas fundas)
                  {res.sonda.consultas?.length > 1 && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: "pointer", opacity: 0.75 }}>por consulta ({res.sonda.consultas.length})</summary>
                      {res.sonda.consultas.map((s, i) => (
                        <div key={i} style={{ opacity: 0.85 }}>
                          {s.territorio} · {s.termo}: {s.erro
                            ? <span style={{ color: "var(--red)" }}>{s.erro}</span>
                            : <b>{n(s.creators)}</b>}
                        </div>
                      ))}
                    </details>
                  )}
                  <br />
                  Custo estimado <b>{n(res.sonda.custo_estimado_com_universo)} unidades</b>
                  {" "}(verificação: {res.sonda.custo_da_sonda_unidades}) ·
                  {" "}saldo Tubular <b>{n(res.sonda.saldo_apos_sonda ?? res.saldo_tubular)}</b>
                  {res.expira ? ` (repõe em ${res.expira})` : ""} · piso {n(res.piso)}
                </>
              )}
              {res.sonda?.erro && <span style={{ color: "var(--red)" }}>{res.sonda.erro}</span>}
              {!res.sonda && <>Custo estimado <b>{n(res.custo_estimado_unidades)} unidades</b> · saldo <b>{n(res.saldo_tubular)}</b></>}
              {res.bloqueado_por ? <><br /><span style={{ color: "var(--red)" }}>{res.bloqueado_por}</span></> : ""}
            </div>
          )}

          {res && !res.dry && (
            <div className="disc-runner-res">
              <b>{res.gravados}</b> novos prospects
              {res.por_plataforma && Object.keys(res.por_plataforma).length
                ? " — " + Object.entries(res.por_plataforma).map(([p, k]) => `${p} ${k}`).join(", ")
                : ""}
              <br />
              {n(res.listados)} listados
              {res.ja_na_base > 0 ? ` → ${n(res.ja_na_base)} já na base` : ""}
              {" "}→ {n(res.ineditos_totais)} inéditos
              {res.novos_apos_dedup < res.ineditos_totais ? ` → tecto de ${n(res.novos_apos_dedup)}` : ""}
              {" "}→ {n(res.detalhados)} com detalhe
              {res.descartados && Object.values(res.descartados).some((v) => v > 0) && (
                <> → descartados: {[
                  res.descartados.fora_da_faixa ? `${res.descartados.fora_da_faixa} fora da banda por plataforma` : null,
                  res.descartados.ja_na_base_por_handle ? `${res.descartados.ja_na_base_por_handle} já na base pelo @` : null,
                  res.descartados.inactivos ? `${res.descartados.inactivos} inativos` : null,
                  res.descartados.sem_conta ? `${res.descartados.sem_conta} sem conta IG/TikTok` : null,
                  res.descartados.sem_detalhe ? `${res.descartados.sem_detalhe} sem detalhe` : null,
                ].filter(Boolean).join(", ")}</>
              )}
              {" "}→ <b>{res.gravados} gravados</b>
              {res.graduados_por_fallback > 0 ? ` (${res.graduados_por_fallback} sem série mensal, graduados pelo perfil)` : ""}
              <br />
              {res.chamadas_tubular} chamadas, ~{n(res.custo_real_estimado)} unidades ·
              {" "}saldo <b>{n(res.saldo_tubular)}</b> · {res.segundos}s
              {res.tempo_esgotado ? " · tempo esgotado neste elo" : ""}
              {res.cadeia && <>
                <br />
                {res.cadeia.continua
                  ? <><b>Cadeia em curso</b> — elo {res.cadeia.elo} feito, {res.cadeia.gravados_acumulados} de {res.cadeia.alvo} acumulados,
                      {" "}{res.cadeia.particoes_feitas} de {res.cadeia.particoes} partições listadas, {res.cadeia.pendentes} à espera.
                      O elo {res.cadeia.proximo_elo} está a correr — <b>mantém este separador aberto</b>.</>
                  : <><b>Cadeia terminada</b> no elo {res.cadeia.elo} com {res.cadeia.gravados_acumulados} de {res.cadeia.alvo} — {res.cadeia.motivo}.</>}
              </>}
              {res.gravados > 0 && <>
                <br />
                <a href="/descobertas?desde=1" className="disc-runner-link">Ver as descobertas de hoje →</a>
                {" · "}entram com @ e plataforma — promovíveis de imediato.
              </>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
