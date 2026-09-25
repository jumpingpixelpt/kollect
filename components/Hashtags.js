import PainelPendente from "@/components/PainelPendente";

/**
 * PRINCIPAIS HASHTAGS — ranking com contagem, como nos direcionais (slide 22).
 *
 * É contagem, não interpretação: sai das legendas que já estão na base (videos.title),
 * sem passar por IA. Por isso pôde entrar sem esperar pela decisão sobre a nuvem de
 * palavras, que precisa de escolher fontes (legendas? falas?) e de decidir o que fazer
 * às marcas — ver a pergunta P11 do documento de arranque.
 *
 * Duas regras que mudam o número:
 *  - Uma hashtag repetida na mesma legenda conta UMA vez. Quem escreve #cabelo três vezes
 *    no mesmo texto não fala do tema três vezes; a contagem é de PEÇAS, e é isso que a
 *    etiqueta diz ("em N peças").
 *  - O agrupamento é sem maiúsculas e sem acentos (#CabeloCacheado e #cabelocacheado são a
 *    mesma), mas mostra-se a forma mais usada, que é como o creator a escreve.
 *
 * A base vem sempre declarada: hashtags existem em cerca de metade do acervo, e um ranking
 * sem denominador faz "3 peças" parecer um hábito quando é uma coincidência.
 */
const chave = (h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// #palavra, incluindo acentos e _; para antes de espaço, pontuação ou outra #
const RE = /#([\p{L}\p{N}_]{2,})/gu;

export function extrairHashtags(videos) {
  const conta = new Map();   // chave -> { n, formas: Map<forma, vezes> }
  let comHashtag = 0;
  for (const v of videos || []) {
    const texto = v?.title;
    if (!texto) continue;
    // Set: dedupe dentro da mesma peça
    const naPeca = new Set();
    for (const m of String(texto).matchAll(RE)) naPeca.add(m[1]);
    if (!naPeca.size) continue;
    comHashtag++;
    for (const forma of naPeca) {
      const k = chave(forma);
      const e = conta.get(k) || { n: 0, formas: new Map() };
      e.n++;
      e.formas.set(forma, (e.formas.get(forma) || 0) + 1);
      conta.set(k, e);
    }
  }
  const lista = [...conta.entries()]
    .map(([k, e]) => {
      const forma = [...e.formas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { termo: forma, n: e.n };
    })
    .sort((a, b) => b.n - a.n || a.termo.localeCompare(b.termo, "pt-BR"));
  return { lista, comHashtag, total: (videos || []).length };
}

export default function Hashtags({ videos, limite = 24 }) {
  const { lista, comHashtag, total } = extrairHashtags(videos);

  if (!lista.length) return (
    <PainelPendente titulo="Principais hashtags" sub="contagem das legendas"
      passo="import-videos (/api/import-videos)"
      nota="As hashtags saem das legendas das peças. Sem legendas importadas — ou sem hashtags nelas — não há o que contar." />
  );

  const top = lista.slice(0, limite);
  const max = top[0]?.n || 1;

  return (
    <div className="panel">
      <h3>Principais hashtags <span>· contagem das legendas</span></h3>
      {/* sem bloco "O que é / Por que acompanhar" (feedback do cliente, set/2026): a leitura vai na frase */}
      <p className="fc-leitura">{top[0] ? `#${top[0].termo} é a hashtag mais usada (${top[0].n} peça${top[0].n > 1 ? "s" : ""})${top[1] ? `, seguida de #${top[1].termo}` : ""} — a auto-descrição da creator, nas palavras dela.` : null}</p>

      <div className="htags">
        {top.map((h) => (
          <div className="htag" key={h.termo}>
            <span className="htag-t">#{h.termo}</span>
            <span className="htag-bar"><i style={{ width: `${(h.n / max) * 100}%` }} /></span>
            <b className="htag-n">{h.n}</b>
          </div>
        ))}
      </div>

      <div className="fc-base" style={{ marginTop: 14 }}>
        {lista.length} hashtag{lista.length === 1 ? "" : "s"} distintas em {comHashtag} de {total} peça{total === 1 ? "" : "s"}
        {lista.length > top.length ? ` · a mostrar as ${top.length} mais usadas` : ""}. A contagem é de peças em que a hashtag aparece.
      </div>
    </div>
  );
}
