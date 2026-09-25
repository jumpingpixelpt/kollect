import Link from "next/link";
import { painelResumo } from "@/lib/painel-resumo";
import { CLIENTS, DEFAULT_CLIENT } from "@/lib/clients";

export const revalidate = 60;

const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k" : String(Math.round(n));
const pct = (a, b) => (b ? (a / b) * 100 : 0);

// As três tags do cliente (set/2026): KOL, Rising Star e Pool — Pool junta Hidden Gem,
// Brand Safe Performer e elegível sem classe.
const CLASSE = {
  kol: ["KOL", "var(--green)"],
  rising_star: ["Rising Star", "var(--gold-bright)"],
  pool: ["Pool", "var(--gold)"],
};
// Nomes de exibição das fontes de descoberta. O painel listava duas fontes fixas (IC e
// Tubular) com o rótulo "congelada" escrito à mão — ficava desatualizado a cada mudança de
// motor (afinação do cliente, jul/2026). Agora lê a view prospect_fontes: fonte nova na base
// aparece sozinha, com o próprio nome como fallback.
const FONTE_LABEL = {
  influencers_club: "influencers.club",
  tubular: "Tubular · catálogo",
  "tubular-video": "Tubular · vídeos",
  "caption-tk": "Apify · legendas TikTok",
  "caption-ig": "Apify · legendas Instagram",
  "hashtag-caption": "Apify · hashtags",
  "csv-liso": "Importação · CSV Liso dos Sonhos",
  "xlsx-elseve": "Importação · Excel KOLs Elsève",
};

export default async function TermometroPage(props) {
  const searchParams = await props.searchParams;
  const client = CLIENTS.some((x) => x.id === searchParams?.cliente) ? searchParams.cliente : DEFAULT_CLIENT;

  // A agregação conta TODOS os creators; a consulta de linhas antiga parava em 1.000.
  // Preserva as três tags e distingue quem ainda não tem cálculo dos inelegíveis.
  const { termometro: { universo, qualificadas, comGrowth, noRadar, classes, fontes } } = await painelResumo();

  const wlog = (n) => universo > 1 ? Math.max(8, (Math.log10(n + 1) / Math.log10(universo + 1)) * 100) : 100;
  const stages = [
    { k: "Universo mapeado", n: universo, d: "todo o universo beauty BR varrido pelas fontes de descoberta", c: "var(--text-dim)" },
    { k: "Pool qualificado", n: qualificadas, d: "passam no portão de qualidade (mini-score >= 50: engajamento + tamanho + crescimento)", c: "var(--gold)" },
    { k: "No radar", n: noRadar, d: "promovidas e analisadas a fundo (território, marcas, fit, classe KOL)", c: "var(--gold-bright)" },
  ];

  return (
    <div className="wrap">
      <section className="hero" style={{ paddingBottom: 24 }}>
        <h1>O funil, <em>na transparência.</em></h1>
        <p>
          De todo o universo de beauty creators ao casting final: quantas a gente mapeia, quantas
          passam no filtro de qualidade e quantas viram dossiê analisado. O briefing busca dentro
          do <strong>pool qualificado</strong> — não de uma lista curada na mão.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 22 }}>
        <h3>Termômetro do funil <span>· cobertura ao vivo</span></h3>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {stages.map((s, i) => (
            <div key={s.k}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, letterSpacing: "0.04em", color: "var(--text)" }}>{s.k}</span>
                <b style={{ fontSize: 22, fontFamily: "var(--serif)", color: s.c }}>{fmt(s.n)}</b>
              </div>
              <div style={{ height: 14, background: "var(--track)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${wlog(s.n)}%`, height: "100%", background: `linear-gradient(90deg, ${s.c}, rgba(227,192,107,0.25))`, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
                {s.d}
                {i > 0 && <span style={{ color: "var(--text-dim)" }}> · {pct(s.n, stages[i - 1].n).toFixed(pct(s.n, stages[i - 1].n) < 10 ? 1 : 0)}% da etapa anterior</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="formula-note" style={{ marginTop: 20 }}>
          O corte de "qualidade" é um portão entre a API e a ferramenta — engajamento + tamanho + crescimento.
          O crescimento é medido por nós (delta de seguidores entre as varreduras), então o pool qualificado
          fica mais preciso a cada dia conforme o histórico acumula.
        </div>
      </section>

      <section className="stats" style={{ marginBottom: 22 }}>
        <div className="stat"><div className="n">{fmt(universo)}</div><div className="l">Universo mapeado</div></div>
        <div className="stat"><div className="n">{fmt(qualificadas)}</div><div className="l">Pool qualificado</div></div>
        <div className="stat"><div className="n">{fmt(noRadar)}</div><div className="l">No radar (analisadas)</div></div>
        <div className="stat"><div className="n">{pct(comGrowth, universo).toFixed(1)}%</div><div className="l">Com crescimento medido</div></div>
      </section>

      <div className="two-col">
        <div className="panel">
          <h3>Fontes do universo</h3>
          <div className="panel-desc"><b>De onde vêm os prospects.</b> Contagem ao vivo por fonte de descoberta, com a data da entrada mais recente de cada uma.</div>
          {(fontes ?? []).map((f) => (
            <div className="pillar" key={f.fonte}>
              <div className="row">
                <span>{FONTE_LABEL[f.fonte] || f.fonte}{f.ultima_descoberta ? <span style={{ color: "var(--text-faint)" }}> — últ. {f.ultima_descoberta}</span> : null}</span>
                <b>{fmt(f.n)}</b>
              </div>
              <div className="track"><div className="fill" style={{ width: `${pct(f.n, universo)}%` }} /></div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>Tags no radar <span>· {noRadar} analisadas</span></h3>
          {Object.entries(CLASSE).map(([k, v]) => (
            <div className="pillar" key={k}>
              <div className="row"><span style={{ color: v[1] }}>{v[0]}</span><b>{classes[k] || 0}</b></div>
              <div className="track"><div className="fill" style={{ width: `${pct(classes[k] || 0, noRadar)}%`, background: v[1] }} /></div>
            </div>
          ))}
          {classes.inelegivel ? <div className="formula-note">{classes.inelegivel} inelegíveis — avaliadas, não cruzam os cortes do briefing (território, consistência ou brand safety).</div> : null}
          {classes.sem_calculo ? <div className="formula-note">{classes.sem_calculo} ainda sem tag (recém-promovidas, aguardam a cadeia).</div> : null}
        </div>
      </div>

      <footer className="footer">
        <span>KOLLECT by Snack</span>
        <span>Termômetro do funil · atualizado ao vivo</span>
      </footer>
    </div>
  );
}
