// Aderência ao briefing solicitada em 15/09/2026: cada requisito tem o mesmo peso.
// Esta leitura não usa Radar Score, Score KOL, match_score ou posição no casting e
// não altera a seleção, as permissões nem a exceção de inclusão manual ao disaster.
// Dados ausentes e condições sem uma régua objetiva ficam pendentes, no denominador.
// 100/100 significa que todos os requisitos listados têm evidência confirmada.

const texto = (v) => typeof v === "string" ? v.trim() : "";
const normalizar = (v) => texto(v).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_/\-]+/g, " ").replace(/\s+/g, " ").trim();
const numero = (v) => {
  if (v == null || typeof v === "boolean" || (typeof v !== "number" && typeof v !== "string") || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const lista = (v) => Array.isArray(v) ? v : [];
const numeroTexto = (v) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
const contagemTexto = (v) => v >= 1e6 ? `${numeroTexto(v / 1e6)}M` : v >= 1e3 ? `${numeroTexto(v / 1e3)}k` : String(Math.round(v));
const PLATAFORMAS = { tiktok: "TikTok", instagram: "Instagram" };
const TERRITORIOS = {
  cabelo: ["cabelo", "cabelos", "capilar", "hair"],
  unhas: ["unha", "unhas", "nail", "nails"],
  maquiagem: ["maquiagem", "make", "makeup"],
  skincare: ["pele", "skincare", "skin care"],
  perfume: ["perfume", "perfumes", "perfumaria", "fragrancia", "fragrancias"],
  cilios: ["cilios", "lash", "lashes"],
  estetica: ["estetica"],
};
function territorioDe(v) {
  const n = normalizar(v);
  return Object.keys(TERRITORIOS).find((k) => TERRITORIOS[k].includes(n)) || null;
}
function contasDe(creator, contas) {
  const vistas = new Set();
  return [creator, ...lista(contas)].filter((c) => {
    if (!c || typeof c !== "object") return false;
    if (![c.id, c.handle, c.platform, c.followers].some((v) => v != null)) return false;
    const chave = c.id || `${normalizar(c.platform)}:${normalizar(c.handle)}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}
function descricaoContas(contas) {
  return contas.map((c) => `${texto(c.handle) ? `@${texto(c.handle).replace(/^@/, "")}` : PLATAFORMAS[normalizar(c.platform)] || "Conta"}: ${numero(c.followers) == null ? "seguidores não disponíveis" : `${contagemTexto(numero(c.followers))} seguidores`}`).join("; ");
}

/**
 * Avalia o retrato já carregado do creator e suas contas ligadas manualmente.
 * `contas` deve conter todas as contas conhecidas dessa pessoa; nunca se somam redes.
 * Plataforma "ambas" exige TikTok e Instagram, como o seletor de briefing informa.
 * A faixa é inclusiva, por rede pedida; zero nos limites legados significa sem limite.
 * Território confirmado no formulário vence o texto da IA. Presença registrada conta;
 * sem percentual mínimo no briefing, não inventamos dominância mínima de conteúdo.
 * Keywords expandidas pela IA, marca, objetivo e referência são contexto, não uma
 * lista artificial de requisitos. Perfil livre, público sem limiar e ausência de
 * termos proibidos precisam de validação e não recebem confirmação automática.
 */
export function avaliarRequisitos(parsed = {}, creator = {}, { contas = [] } = {}) {
  parsed ||= {};
  creator ||= {};
  const requisitos = [];
  const adicionar = (id, label, status, evidencia) => requisitos.push({ id, label, status, evidencia });
  const conhecidas = contasDe(creator, contas);
  const plataforma = normalizar(parsed.plataforma);
  const redes = ["ambas", "tiktok e instagram", "instagram e tiktok"].includes(plataforma)
    ? ["tiktok", "instagram"] : PLATAFORMAS[plataforma] ? [plataforma] : [];
  for (const rede of redes) {
    const presentes = conhecidas.filter((c) => normalizar(c.platform) === rede);
    const incompletas = !conhecidas.length || conhecidas.some((c) => !normalizar(c.platform));
    adicionar(`plataforma-${rede}`, `Presença no ${PLATAFORMAS[rede]}`,
      presentes.length ? "atingido" : incompletas ? "pendente" : "nao_atingido",
      presentes.length ? `${presentes.map((c) => texto(c.handle) ? `@${texto(c.handle).replace(/^@/, "")}` : "Conta cadastrada").join(", ")} no ${PLATAFORMAS[rede]}.`
        : incompletas ? "Plataformas das contas ainda não informadas." : `Nenhuma conta ligada no ${PLATAFORMAS[rede]}.`);
  }
  if (plataforma && !redes.length) adicionar("plataforma", `Plataforma: ${texto(parsed.plataforma)}`, "pendente", "Plataforma sem uma regra de verificação definida.");

  const minimo = numero(parsed.faixa_min);
  const maximo = numero(parsed.faixa_max);
  const limiteInvalido = [parsed.faixa_min, parsed.faixa_max].some((v) => v != null && v !== "" && numero(v) == null);
  const faixaSolicitada = minimo > 0 || maximo > 0 || limiteInvalido;
  if (faixaSolicitada) {
    const faixaValida = !limiteInvalido && !(minimo > 0 && maximo > 0 && minimo > maximo);
    const faixa = minimo > 0 && maximo > 0 ? `${contagemTexto(minimo)} a ${contagemTexto(maximo)}`
      : minimo > 0 ? `a partir de ${contagemTexto(minimo)}` : maximo > 0 ? `até ${contagemTexto(maximo)}` : "a confirmar";
    for (const rede of redes.length ? redes : [null]) {
      const candidatas = rede ? conhecidas.filter((c) => normalizar(c.platform) === rede) : conhecidas;
      const dentro = candidatas.some((c) => {
        const n = numero(c.followers);
        return n != null && (!(minimo > 0) || n >= minimo) && (!(maximo > 0) || n <= maximo);
      });
      const falta = !candidatas.length || candidatas.some((c) => numero(c.followers) == null);
      adicionar(`faixa${rede ? `-${rede}` : ""}`, `Seguidores${rede ? ` no ${PLATAFORMAS[rede]}` : ""}: ${faixa}`,
        !faixaValida ? "pendente" : dentro ? "atingido" : falta ? "pendente" : "nao_atingido",
        !faixaValida ? "Os limites do briefing precisam ser corrigidos."
          : descricaoContas(candidatas) || "Sem dados de seguidores para a rede solicitada.");
    }
  }

  const territorio = texto(parsed.campos?.tema_territorio?.claro ? parsed.campos.tema_territorio.valor : parsed.territorio);
  const nichos = lista(creator.brand_history?.nichos);
  const subNichos = lista(creator.brand_history?.sub_nichos).map((n) => typeof n === "string" ? n : n?.nome || n?.sub_nicho).filter(Boolean);
  if (territorio) {
    const esperado = territorioDe(territorio);
    const metricas = creator.kol_screen?.metricas || {};
    const encontrados = esperado ? nichos.filter((n) => territorioDe(n?.nicho) === esperado) : [];
    const confirmado = encontrados.find((n) => numero(n.pct) > 0);
    const zeroExplicito = encontrados.length > 0 && encontrados.every((n) => numero(n.pct) === 0);
    const principal = esperado && territorioDe(metricas.niche_bucket) === esperado && !zeroExplicito && numero(metricas.niche_density) !== 0;
    const resumo = nichos.filter((n) => texto(n?.nicho)).map((n) => `${n.nicho}${numero(n.pct) != null ? ` (${numeroTexto(numero(n.pct))}%)` : ""}`).join(", ");
    adicionar("territorio", `Conteúdo de ${territorio}`,
      confirmado || principal ? "atingido" : zeroExplicito ? "nao_atingido" : "pendente",
      confirmado ? `${confirmado.nicho}: ${numeroTexto(numero(confirmado.pct))}% do conteúdo analisado.`
        : principal ? `Território principal registrado na análise: ${metricas.niche_bucket}.`
          : zeroExplicito ? `${territorio}: 0% no conteúdo analisado.`
            : `${resumo ? `Territórios registrados: ${resumo}. ` : "Sem território de conteúdo confirmado. "}${esperado ? "A ausência de um tema na análise não confirma que o creator não o aborda." : "O território em texto livre precisa de validação editorial."}`);
  }
  if (texto(parsed.sub_territorio)) {
    const sub = texto(parsed.sub_territorio);
    const hit = subNichos.find((n) => normalizar(n) === normalizar(sub));
    adicionar("subterritorio", `Subterritório: ${sub}`, hit ? "atingido" : "pendente",
      hit ? `Subterritório registrado: ${hit}.` : `Sem correspondência explícita na análise.${subNichos.length ? ` Subterritórios registrados: ${subNichos.join(", ")}.` : ""}`);
  }

  const publico = normalizar(parsed.publico_alvo);
  if (publico && publico !== "ambos") {
    const audiencia = creator.audience || {};
    const codigo = publico === "feminino" ? "FEMALE" : publico === "masculino" ? "MALE" : null;
    const genero = codigo ? lista(audiencia.generos).find((g) => g?.code === codigo) : null;
    const peso = numero(genero?.weight);
    const mulheres = numero(audiencia.mulheres_pct);
    const pct = peso != null && peso <= 1 ? peso * 100 : mulheres != null && mulheres <= 100
      ? publico === "feminino" ? mulheres : publico === "masculino" ? 100 - mulheres : null : null;
    adicionar("publico", `Público ${texto(parsed.publico_alvo)}`, "pendente",
      `${pct != null ? `${numeroTexto(pct)}% da audiência registrada é desse público. ` : "Sem demografia confirmada para esse público. "}O briefing não define um percentual mínimo para considerar o requisito atingido.`);
  }
  if (texto(parsed.perfil)) adicionar("perfil", `Perfil: ${texto(parsed.perfil)}`, "pendente", "Tom, formato e autoridade descritos em texto livre precisam de validação editorial.");

  const negativos = [...new Set(lista(parsed.negativos).map(normalizar).filter(Boolean))];
  const evidencias = [
    ...nichos.filter((n) => numero(n?.pct) > 0).map((n) => texto(n.nicho)),
    ...subNichos,
    ...lista(creator.brand_history?.marcas).map((m) => texto(m?.marca)),
    texto(creator.niche), texto(creator.category),
  ].filter(Boolean);
  negativos.forEach((negativo, i) => {
    const encontrado = evidencias.find((e) => ` ${normalizar(e)} `.includes(` ${negativo} `));
    adicionar(`negativo-${i}`, `Evitar: ${negativo}`, encontrado ? "nao_atingido" : "pendente",
      encontrado ? `Termo presente na análise: ${encontrado}.`
        : "Nenhuma ocorrência nos dados carregados; a ausência de registros não confirma que a restrição foi cumprida.");
  });

  const atingidos = requisitos.filter((r) => r.status === "atingido").length;
  const pendentes = requisitos.filter((r) => r.status === "pendente").length;
  const total = requisitos.length;
  const score = !total ? null : atingidos === total ? 100 : Math.min(99.99, Math.round(atingidos / total * 10000) / 100);
  return { score, atingidos, total, pendentes, requisitos };
}
