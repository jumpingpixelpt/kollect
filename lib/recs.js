/**
 * O QUE CONTRATAR — recomendações de formato baseadas no padrão de conteúdo
 * real do creator: notas da análise de IA, saves/shares e classificação.
 */

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function contentRecs(creator, videos = [], snaps = [], classification = "observacao") {
  const a = videos.filter((v) => v.analysis);
  const exp = avg(a.map((v) => v.analysis.expertise || 0));
  const did = avg(a.map((v) => v.analysis.didatica || 0));
  const orig = avg(a.map((v) => v.analysis.originalidade || 0));
  const last = snaps.at?.(-1) || {};
  const saves = Number(last.saves_per_1k) || 0;
  const shares = Number(last.shares_per_1k) || 0;
  const temas = [...new Set(a.flatMap((v) => v.analysis.temas || []))].slice(0, 4);

  const recs = [];

  if (classification === "rising")
    recs.push({ t: "Contrato de embaixador early", w: 10,
      d: `Cresce e sustenta — travar cachê agora, antes da base multiplicar. É a janela: o preço de hoje não existe mais em 90 dias.` });
  if (classification === "momento")
    recs.push({ t: "Ação pontual de awareness — não embaixador", w: 10,
      d: `Padrão de viral sem sustentação: aproveitar o alcance do momento com uma ação única, sem contrato longo. Reavaliar em 60 dias.` });

  if (exp >= 8)
    recs.push({ t: "Review técnico assinado", w: exp,
      d: `Expertise ${exp.toFixed(1)}/10 na análise de conteúdo: a audiência confia no veredito. Produto na mão do creator com liberdade editorial — o aval dele vale mais que o roteiro da marca.` });
  if (did >= 8)
    recs.push({ t: "Série tutorial em capítulos", w: did,
      d: `Didática ${did.toFixed(1)}/10: ensina de verdade. Série de 3+ episódios com o produto dentro do método dele — conteúdo que vira consulta permanente.` });
  if (saves >= 25)
    recs.push({ t: "Conteúdo de prateleira (save-first)", w: saves / 4,
      d: `${saves.toFixed(0)} saves por 1k views: a audiência guarda pra voltar. Conteúdo-referência (guia, protocolo, comparativo) com o produto como ferramenta do método.` });
  if (shares >= 14)
    recs.push({ t: "Tese compartilhável", w: shares / 3,
      d: `${shares.toFixed(0)} shares por 1k views: o público usa o conteúdo pra se expressar. Vídeo de opinião/posicionamento que a audiência manda pros amigos — a marca pega carona na identidade.` });
  if (orig >= 9)
    recs.push({ t: "Co-criação de formato proprietário", w: orig,
      d: `Originalidade ${orig.toFixed(1)}/10: dono de um território vazio. Criar um quadro fixo com a marca dentro do universo dele — exclusividade que concorrente não copia.` });

  const byCat = {
    skincare: { t: "Teste real de 30 dias", d: "Padrão do nicho: acompanhamento honesto com antes/depois sem filtro. O produto entra no protocolo, não no anúncio." },
    make: { t: "Transformação replicável", d: "Tutorial de resultado aspiracional mas executável em casa — o produto como atalho do truque." },
    cabelo: { t: "Protocolo passo a passo", d: "A comunidade trata os vídeos como consulta: cronograma/rotina completa com o produto dentro do método." },
    perfume: { t: "Curadoria com método", d: "Provador às cegas, comparativo ou método de escolha — o produto disputando de igual e ganhando no critério." },
    tech: { t: "Veredito de device + rotina", d: "Unboxing com teste real e leitura de resultado — ciência traduzida pra rotina." },
    lifestyle: { t: "Integração de rotina", d: "O produto entra na rotina filmada como hábito, não como merchan — nativo do formato dele." },
  };
  if (byCat[creator.category]) recs.push({ ...byCat[creator.category], w: 6 });

  return { recs: recs.sort((x, y) => y.w - x.w).slice(0, 4), temas, metrics: { exp, did, orig, saves, shares } };
}
