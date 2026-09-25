// Explicações curtas dos conceitos da plataforma, para o tooltip que aparece ao passar o
// rato (ou tocar) no selo. UM texto por conceito, partilhado por todos os sítios que o
// mostram — cartão, ficha, painel da squad — para nunca haver duas definições em circulação.
//
// Cada texto diz, quando se aplica: o que é, a FÓRMULA, a unidade, a janela e a base sobre
// que foi calculado. Os direcionais (slide 8) pedem o racional a par do valor, e um número
// sem denominador declarado é o que faz duas pessoas lerem a mesma tabela de forma diferente.
//
// Regra ao mexer: a fórmula vive no módulo, o texto vive aqui. Se mudar lá, muda aqui.
//   janela → lib/score.js (janela_aberta = Radar Score ≥ 75 e < 100 mil seguidores)
//   radar  → lib/score.js (radarScore)
//   er     → lib/engagement.js (engRateViews)
//   cpe    → lib/cpe.js
//   mini   → lib/score.js (funnelMiniScore)
export const CONCEITO = {
  janela:
    "Janela de cachê: o creator já tem Radar Score de 75 ou mais (está a subir) e ainda tem menos de 100 mil seguidores — " +
    "entrega como grande e cobra como pequeno. É a altura de contratar, antes de o cachê escalar. " +
    "Fecha-se quando passa os 100 mil seguidores ou o Radar Score cai abaixo de 75.",

  radar:
    "Radar Score: mede momentum de CRESCIMENTO, não fit a um briefing. Soma quatro pilares — " +
    "momentum das últimas leituras (até 30), tração de views sobre a base de seguidores (até 30), " +
    "autoridade e foco de conteúdo pela análise das peças (até 25) e o bónus de janela de cachê (até 10). " +
    "Convive com o Score KOL, que mede outra coisa.",

  kol:
    "Score KOL: fit ao briefing, medido contra os pares do mesmo território e do mesmo público — é uma régua " +
    "relativa, não absoluta. Só existe para quem cruza os cortes de elegibilidade do briefing; quem não cruza " +
    "fica sem nota e com o motivo à vista, em vez de com um zero que parecia desempenho.",

  er:
    "Taxa de engajamento: engajamentos a dividir por views, em percentagem. Nunca sobre seguidores — " +
    "decisão do cliente de jun/2026, porque a base de seguidores distorce a comparação entre creators. " +
    "Sem views na fonte não há taxa: fica sem valor, e não zero.",

  erConjunta:
    "ER conjunta da squad: soma dos engajamentos projetados a dividir pela soma das views projetadas, " +
    "sobre o subconjunto que tem as duas métricas. Não é a média das taxas individuais — nessa, um creator " +
    "com 2 mil views pesaria o mesmo que um com 2 milhões. Quem não tem taxa fica fora da conta, não entra como zero.",

  viewsEstimadas:
    "Views estimadas: soma da média de views por peça do último snapshot de cada creator, para UM post por creator. " +
    "É uma estimativa a partir do histórico, não uma garantia. Quem ainda não tem histórico de views não entra.",

  engProjetado:
    "Engajamento projetado: para cada creator, as views estimadas dele × a taxa de engajamento dele; somado. " +
    "Só entram os creators que têm taxa medida — os outros contam para as views e ficam fora deste número.",

  alcanceSomado:
    "Alcance somado: soma dos seguidores das contas da squad. NÃO é audiência única — contas diferentes contêm " +
    "as mesmas pessoas, e a sobreposição não é medível com os dados que temos. Serve para dimensionar, não para prometer alcance.",

  scoreKolMedio:
    "Score KOL médio: média simples do Score KOL dos membros que têm nota. Só de Score KOL — misturar com Radar " +
    "Score ou com o mini-score do funil seria somar réguas diferentes na mesma casa.",

  ultimaLeitura:
    "Última leitura: a data em que a plataforma recolheu pela última vez os números deste creator " +
    "(seguidores, views, engajamento). Tudo o que a ficha mostra é dessa data, não de hoje — as peças " +
    "e as métricas só mudam quando o creator é reprocessado.",

  cpe:
    "CPE: custo por engajamento — o cachê a dividir pelos engajamentos médios por peça. Só se lê em comparação, " +
    "porque o mesmo CPE é barato num nicho e caro noutro: a plataforma compara-o com a mediana da faixa de tamanho " +
    "(até 50k, 50–250k, 250k+) e com a mediana do nicho.",

  miniScore:
    "Mini-score do funil: a triagem barata, sem IA, que qualifica o universo das descobertas. " +
    "Engajamento (×3, teto 30) + tamanho (10–300k vale 30, 3–10k vale 18, o resto 8) + crescimento mensal medido por nós " +
    "(×8, teto 40). Sem leitura de crescimento, essa parcela é 0 — o creator não é penalizado, apenas ainda não somou.",
};
