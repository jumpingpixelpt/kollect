const texto = (value) => typeof value === "string" ? value.trim() : "";
const norm = (value) => String(value ?? "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function dataValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function filtrosHistorico(params = {}) {
  const q = texto(params.q);
  const ord = ["antigos", "casting", "nome"].includes(params.ord) ? params.ord : "";
  const inicio = texto(params.de);
  const fim = texto(params.ate);
  const de = dataValida(inicio) ? inicio : "";
  const ate = dataValida(fim) ? fim : "";
  const erro = (inicio && !de) || (fim && !ate) ? "Informe datas válidas para filtrar o histórico."
    : de && ate && de > ate ? "A data final deve ser igual ou posterior à data inicial." : "";
  return { q, ord, de, ate, erro };
}

// O filtro e a data exibida usam o mesmo calendário UTC da criação persistida.
// Os dois limites incluem o dia inteiro; datas vazias deixam esse lado em aberto.
export function filtrarHistorico(campanhas, { q = "", de = "", ate = "", erro = "" } = {}) {
  if (erro) return [];
  const busca = norm(q);
  return campanhas.filter((campanha) => {
    if (busca && !norm(campanha.name).includes(busca)) return false;
    if (!de && !ate) return true;
    const date = campanha.created_at ? new Date(campanha.created_at) : null;
    if (!date || !Number.isFinite(date.getTime())) return false;
    const dia = date.toISOString().slice(0, 10);
    return (!de || dia >= de) && (!ate || dia <= ate);
  });
}
