// Datas curtas da ficha: "14 jun" e "14 jun 26".
//
// Existe porque `toLocaleDateString("pt-BR")` escreve "14 de jun. de 26" — quatro palavras
// e dois pontos onde a ficha tem lugar para uma etiqueta. E porque a mesma dança de
// `.replace(".", "")` já ia em quatro ficheiros, cada um a apagar um ponto diferente.
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const parse = (d) => {
  if (!d) return null;
  // meio-dia local: `new Date("2026-08-04")` é UTC e recua um dia a oeste de Greenwich
  const x = new Date(String(d).slice(0, 10) + "T12:00:00");
  return Number.isNaN(+x) ? null : x;
};

/** "14 jun" · com `ano`, "14 jun 26". */
export function diaCurto(d, ano = false) {
  const x = parse(d);
  if (!x) return "";
  return `${String(x.getDate()).padStart(2, "0")} ${MES[x.getMonth()]}${ano ? ` ${String(x.getFullYear()).slice(2)}` : ""}`;
}

/** "jun 26" — para quem só precisa do mês (última colaboração com uma marca). */
export function mesCurto(d) {
  const x = parse(d);
  return x ? `${MES[x.getMonth()]} ${String(x.getFullYear()).slice(2)}` : "";
}
