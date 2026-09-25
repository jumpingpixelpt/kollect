import PainelPendente from "@/components/PainelPendente";
import { marcaConcorrente } from "@/lib/concorrentes";
import { mesCurto, diaCurto } from "@/lib/datas";

/**
 * MARCAS COM QUE JÁ COLABOROU — o histórico comercial do último ano, com o tipo de relação
 * à vista (publi declarada, afiliado, seeding, menção orgânica).
 *
 * Concorrente e marca do próprio grupo L'Oréal aparecem marcadas: são a diferença entre
 * "já fez beleza" e "já fez beleza para o rival" — informação de negociação, e não
 * decoração de rodapé.
 *
 * Faz par com Tópicos de conteúdo numa .two-col. Pedido do utilizador (02/09/2026): quando
 * há duas caixas na linha, a da esquerda dita a altura e esta faz scroll por dentro. É o
 * que `ajustar` liga — .panel-fit (height:0 + min-height:100%) tira esta caixa do cálculo
 * da altura da linha e .bh-scroll dá o scroll à lista. SÓ UMA caixa do par pode ter
 * .panel-fit: com as duas, a linha da grelha fica sem altura e o Disaster Check
 * desenha-se por cima (foi o bug de 02/09). Por isso a página só liga `ajustar` quando a
 * vizinha tem corpo (temTopicos); com a vizinha em "ainda não gerado", esta fica com
 * altura natural e a lista leva um tecto (.fc-marcas-cap).
 */
const TIPO = {
  publi: ["Publi", "fc-tipo-publi"],
  afiliado: ["Afiliado", "fc-tipo-afiliado"],
  seeding: ["Seeding", "fc-tipo-seeding"],
  organica: ["Orgânica", "fc-tipo-organica"],
};

// A Tubular grava as peças do TikTok como tiktok.com/@redirect-to/video/ID: o TikTok resolve
// pelo ID, mas o @ vai escrito com o handle da creator para o link ler-se como é.
const urlPeca = (u, handle) => (handle ? String(u || "").replace("/@redirect-to/", `/@${handle}/`) : u);

export default function MarcasColaborou({ history, ajustar = false, handle = null }) {
  const marcas = (history?.marcas || []).filter((m) => m?.marca);
  if (!marcas.length) return (
    <PainelPendente titulo="Marcas com que já colaborou" sub="histórico comercial"
      passo="brand-scan (/api/brand-scan)"
      nota="Se o brand-scan já correu e não achou marca nenhuma, é resposta e não lacuna: o conteúdo do último ano não tem parceria identificável." />
  );

  const ord = { publi: 0, afiliado: 1, seeding: 2, organica: 3 };
  const lista = [...marcas].sort((a, b) => (ord[a.tipo] ?? 4) - (ord[b.tipo] ?? 4) || (b.videos || 0) - (a.videos || 0));

  const publis = lista.filter((m) => m.tipo === "publi");
  const rivais = lista.filter((m) => marcaConcorrente(m.marca) && !marcaConcorrente(m.marca).interna);
  const beleza = lista.filter((m) => m.categoria === "beleza");
  const leitura = [
    publis.length
      ? `${publis.length} marca${publis.length > 1 ? "s" : ""} com publi declarada no último ano (${publis.slice(0, 3).map((m) => m.marca).join(", ")}${publis.length > 3 ? "…" : ""})`
      : "Nenhuma publi declarada no último ano — as marcas aparecem por seeding, afiliação ou menção espontânea",
    beleza.length ? `${beleza.length} de ${lista.length} são de beleza` : null,
    rivais.length ? `rival já presente: ${[...new Set(rivais.map((m) => m.marca))].slice(0, 3).join(", ")}` : "sem marca rival no histórico",
  ].filter(Boolean).join(" · ") + ".";

  return (
    <div className={`panel${ajustar ? " panel-fit" : ""}`}>
      <h3>Marcas com que já colaborou <span>· últimos 12 meses</span></h3>
      {/* leitura em vez de "O que é / Por que acompanhar" (feedback do cliente, set/2026, ponto 16) */}
      <p className="fc-leitura">{leitura}</p>

      <div className={ajustar ? "bh-scroll" : "fc-marcas-cap"}>
      <div className="fc-marcas">
        {lista.map((m) => {
          const hit = marcaConcorrente(m.marca);
          const [rot, cls] = TIPO[m.tipo] || ["Menção", "fc-tipo-organica"];
          return (
            <div className={`fc-marca${hit ? (hit.interna ? " interna" : " rival") : ""}`} key={`${m.marca}-${m.ultima ?? ""}`} title={m.evidencia || undefined}>
              <div className="fc-marca-n">
                {m.marca}
                {hit && <span className="fc-marca-flag">{hit.interna ? `◈ grupo L'Oréal` : `▲ rival · ${hit.grupo}`}</span>}
              </div>
              <div className="fc-marca-m">
                <span className={cls}>{rot}</span>
                {/* peças clicáveis com a data de publicação (feedback do cliente, set/2026, ponto 16);
                    sem URL fica só a contagem e o mês da última */}
                {m.pecas?.length
                  ? <i className="fc-marca-pecas">{m.pecas.slice(0, 4).map((pc, i) => (
                      <a key={pc.url || i} href={urlPeca(pc.url, handle)} target="_blank" rel="noopener noreferrer" title={urlPeca(pc.url, handle)}>↗ {pc.data ? diaCurto(pc.data, true) : `peça ${i + 1}`}</a>
                    ))}{m.pecas.length > 4 ? ` +${m.pecas.length - 4}` : ""}</i>
                  : <>
                    {m.videos ? <i>{m.videos} peça{m.videos > 1 ? "s" : ""}</i> : null}
                    {m.ultima ? <i>publicada em {mesCurto(m.ultima)}</i> : null}
                  </>}
                {m.categoria === "beleza" ? <i>categoria: beleza</i> : m.categoria === "outra" ? <i>categoria: fora de beleza</i> : null}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {history?.brand_engagement?.leitura && (
        <div className="formula-note">{history.brand_engagement.leitura}</div>
      )}
    </div>
  );
}
