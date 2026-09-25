// Os campos que a plataforma precisa de perceber num pedido de busca — a régua única
// entre o formulário (onde se estrutura antes), a confirmação (onde se completa o que
// ficou por dizer) e o prompt que lê o briefing. Estava tudo implícito no texto colado:
// quem escrevia "quero creators de cabelo" não sabia que faltava dizer marca, objetivo ou
// plataforma, e o casting saía do palpite do modelo. Agora a falta é visível antes de
// gastar o match.
//
// Feedback do cliente (docs/Kollect - Feedbacks.pdf, set/2026, ponto 6): de sete campos
// livres passou a cinco, três deles fechados — objetivo, território e plataforma são
// escolhas de lista, não frases. Público, perfil de creator e restrições saíram: o público
// tem o seletor de género da confirmação, as restrições já estão em "o que não queremos"
// no formulário, e no lugar do perfil entra o link de um creator de referência (ponto 3).
//
// `parsed` é o campo correspondente no perfil estruturado que o /api/campaign consome
// (o mesmo objeto que os briefings fixos passam à mão) — null quando o campo não tem
// equivalente direto e vive só na leitura. `opcoes` fecha o campo numa lista: o valor
// gravado é `v`, o rótulo é o que se mostra.
//
// Rodada 2 (F1.1, set/2026 — proposta da D1): "Produto ou marca" separou-se em **Marca** e
// **Produto** — o formulário da Busca pede-os logo abaixo da barra, e o parse deriva os
// atributos de cada um (categoria, benefício, ingrediente, público, dor, ocasião) para as
// palavras-chave e os temas da expansão. Ambos opcionais (`opcional`): não contam como
// "por completar". Leituras antigas com `produto_marca` passam por camposCompat().
export const CAMPOS = [
  { k: "marca",           label: "Marca",                        parsed: "marca_alvo", opcional: true },
  { k: "produto",         label: "Produto",                      parsed: "produto", opcional: true },
  { k: "objetivo",        label: "Objetivo da campanha",         parsed: "objetivo",
    opcoes: [["Awareness", "Awareness"], ["Engajamento", "Engajamento"], ["Venda", "Venda"]] },
  { k: "tema_territorio", label: "Território de conteúdo",      parsed: "territorio",
    opcoes: [["Cabelo", "Cabelo"], ["Unha", "Unha"], ["Maquiagem", "Maquiagem"], ["Pele", "Pele"], ["Perfume", "Perfume"]] },
  { k: "plataforma",      label: "Plataforma prioritária",       parsed: "plataforma",
    opcoes: [["tiktok", "TikTok"], ["instagram", "Instagram"], ["ambas", "TikTok e Instagram"]] },
  { k: "referencia",      label: "Perfil de referência (link)",  parsed: "referencia", tipo: "url", opcional: true },
];

// O território escolhido na lista, no vocabulário dos territórios do radar (lib/territorio.js):
// "Pele" é o que o cliente diz, "skincare" é o que o brand-scan escreve.
export const TERRITORIO_KEYWORDS = {
  Cabelo: ["cabelo", "capilar"],
  Unha: ["unha", "unhas", "esmalte"],
  Maquiagem: ["maquiagem", "make"],
  Pele: ["skincare", "pele"],
  Perfume: ["perfume", "fragrância"],
};

export const LIMITE_BRIEFING = 3000;

/** Campos que o modelo não conseguiu ler do texto — os que a confirmação pede para completar
 *  (os opcionais — marca, produto, referência — nunca ficam "por completar"). */
export function porPreencher(campos) {
  return CAMPOS.filter((c) => !c.opcional && (!campos?.[c.k]?.claro || !String(campos[c.k]?.valor || "").trim()));
}

/** Leituras gravadas antes da separação (F1.1): `produto_marca` passa a `marca`. */
export function camposCompat(campos) {
  const c = campos && typeof campos === "object" ? { ...campos } : {};
  if (!c.marca && c.produto_marca) c.marca = c.produto_marca;
  delete c.produto_marca;
  return c;
}

/** Rótulo de um valor fechado ("tiktok" → "TikTok"); texto livre volta como está. */
export function rotulo(campo, valor) {
  const v = String(valor || "").trim();
  if (!v || !campo?.opcoes) return v;
  return campo.opcoes.find(([k]) => k === v)?.[1] ?? v;
}

/** "contas de salão, concorrente X" → ["contas de salão", "concorrente x"] */
export function termos(txt) {
  return String(txt || "")
    .split(/[,;\n]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);
}
