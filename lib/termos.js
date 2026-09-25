// Rótulos de exibição para as chaves de motor que as colheitas antigas (jun/2026)
// gravaram como termo — só na renderização, o valor filtrado continua o gravado:
// "ai:X" = colheita por legenda com IA; "sweep" = varredura Tubular do motor antigo;
// "beauty" = corrida tubular-video sem termo livre (o género era o território);
// "elseve: X" = linha importada do xlsx Elseve.
// Partilhado pelo filtro das Descobertas (ProspectSearch) e pelo do briefing
// (BriefingFilter) — dois mapas divergiam à primeira chave nova.
export const rotuloTermo = (t) =>
  t === "sweep" ? "varredura antiga (sweep)"
    : t === "beauty" ? "género beauty · sem termo livre"
      : t.startsWith("ai:") ? `colheita IA · ${t.slice(3)}`
        : t.startsWith("elseve:") ? `xlsx Elseve · ${t.slice(7).trim().slice(0, 40)}`
          : t;

export const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(".", ",") + "k" : String(Math.round(n));
