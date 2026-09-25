// Regras do casting partilhadas entre o CARTÃO da lista de campanhas e a FICHA da campanha.
//
// Afinação do cliente (docs/KOLLECT AFINAÇÕES.pdf, jul/2026): o cartão dizia "190 no casting"
// e a ficha "Todos 150". O cartão contava TODAS as linhas de campaign_creators — prospects do
// funil, creators entretanto apagadas e não-recomendadas incluídas — enquanto a ficha conta só
// o casting visível. A regra de "quem conta como casting" passa a viver aqui, uma vez, para as
// duas contagens não poderem voltar a desalinhar-se.

/** Ramo do Score KOL que o briefing usa: público masculino → kol_score.masculino. */
export const ksRamoDe = (parsed) => (parsed?.publico_alvo === "masculino" ? "masculino" : "geral");

// classe: o Score KOL novo (Onda 1) vence, no ramo do público do briefing (masculino →
// kol_score.masculino). Inelegível no motor novo NÃO herda a classe antiga — cai em watchlist:
// o Score KOL é a nota de cara pro cliente (decisão do plano, 25/07). Fallback pro kol_screen
// só sem kol_score.
export function classeDe(row, creator, ksRamo = "geral") {
  const ks = creator?.kol_score?.[ksRamo];
  if (ks) {
    if (!ks.classe || ks.classe === "elegivel") return "promissora";
    return ks.classe === "brand_safe_performer" ? "brand_performer" : ks.classe;
  }
  return creator?.kol_screen?.classe || (row.kind === "kol" ? "kol" : row.kind === "rising" ? "rising_star" : "promissora");
}

// Rótulo de cada papel, em português, partilhado entre a ficha da campanha e o Briefing
// match da ficha do creator — antes cada ecrã tinha a sua cópia e a ficha do creator
// mostrava o enum cru ("papel: safe_scale"). "funil" é a linha de prospect trazida pelo
// pré-filtro, ainda sem papel atribuído.
export const PAPEL_LABEL = {
  authority_anchor: "Lidera autoridade",
  rising_bet: "Aposta de descoberta",
  hidden_opportunity: "Eficiência",
  safe_scale: "Sustentação",
  out_of_territory: "Fora do território",
  not_recommended: "Não recomendada",
  funil: "Funil — ainda sem papel",
};

// CAMPAIGN ROLE (papel no brief, dinâmico) — fallback p/ campanhas antigas sem campaign_role
export function roleDe(row, creator, ksRamo = "geral") {
  return row.campaign_role || ({ kol: "authority_anchor", rising_star: "rising_bet", hidden_gem: "hidden_opportunity", brand_performer: "safe_scale" }[classeDe(row, creator, ksRamo)] || "safe_scale");
}

// Conta no casting: creators incluídas manualmente (kind="manual") são escolha explícita do
// usuário e NUNCA somem, mesmo com classificação automática "não recomendada".
// Quem chumba no disaster check (kol_screen.disaster.nivel === "alto") também não entra
// (feedback do cliente, set/2026, ponto 10) — a regra vive em lib/disaster.js.
export const contaNoCasting = (row, creator, ksRamo = "geral") =>
  row.kind === "manual" || (roleDe(row, creator, ksRamo) !== "not_recommended" && creator?.kol_screen?.disaster?.nivel !== "alto");

// O score exibido para uma creator é SEMPRE o da ficha dela — o anel do avatar mostra
// kol_score.geral, e só quando elegível (ver "UMA RÉGUA POR PÁGINA" em
// app/(app)/creator/[id]/page.js). Afinação do cliente: o cartão da campanha mostrava o
// match do briefing (76) ao lado de uma ficha que diz 89 — o mesmo creator, dois números.
export function scoreKolDe(creator) {
  const k8 = creator?.kol_score?.geral ?? null;
  return k8?.elegivel && k8?.score != null ? Math.round(Number(k8.score)) : null;
}

// ── Tag para o cliente (feedback set/2026, pontos 8 e 10) ──
// O cliente não quer classes nem nota à vista: só KOL, Rising Star e Pool. Pool é tudo o
// que passa os cortes sem ser uma das duas — Hidden Gem, Brand Safe Performer, Watchlist e
// "elegível sem classe" (decisão do Rui, 10/09/2026). O Score KOL continua a ser calculado
// (é ele que decide quem entra no casting e quem vai a deep-scan), mas não se mostra.
export const TAG_LABEL = { kol: "KOL", rising_star: "Rising Star", pool: "Pool" };
export const TAG_ORDER = ["kol", "rising_star", "pool"];

export function tagDe(row, creator, ksRamo = "geral") {
  const cls = classeDe(row, creator, ksRamo);
  return cls === "kol" ? "kol" : cls === "rising_star" ? "rising_star" : "pool";
}

/** A mesma tag na ficha do creator, a partir do kol_score gravado (sem linha de casting). */
export function tagDaFicha(creator) {
  const ks = creator?.kol_score?.geral;
  if (!ks) return null;
  if (!ks.elegivel) return "pool";
  return ks.classe === "kol" ? "kol" : ks.classe === "rising_star" ? "rising_star" : "pool";
}
