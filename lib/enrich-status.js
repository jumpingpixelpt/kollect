// Estado do enriquecimento em curso, partilhado entre o botão que o dispara e os painéis
// que esperam pelo resultado.
//
// Existe porque um painel vazio não sabe, sozinho, se o dado ainda vem a caminho ou se
// nunca vai vir — e essas duas coisas pedem mensagens opostas. Sem isto, ou se mostrava
// "a processar" para sempre (mentira assim que a cadeia falha), ou nada (o buraco que
// fazia toda a gente presumir a página partida).
//
// Um store de módulo chega: o botão e os painéis vivem na mesma ficha, no mesmo separador,
// e o estado não precisa de sobreviver a uma navegação — ao voltar à ficha, o servidor já
// devolve o dado ou a ausência dele.
let ativo = false;
const ouvintes = new Set();

export function marcarEnriquecimento(v) {
  ativo = !!v;
  ouvintes.forEach((f) => f(ativo));
}

export function enriquecendo() {
  return ativo;
}

export function ouvirEnriquecimento(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
