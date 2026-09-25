// Do lado do browser: transforma a resposta de uma rota numa frase para o ecrã
// (feedback rodada 2, bug 1). Nunca mostra JSON, stack, "Error:" nem o nome de um
// provedor — se a rota ainda devolver texto técnico (rota antiga, erro de rede), cai na
// mensagem genérica. A rota nova já manda a frase pronta (lib/erro-publico.js).
const GENERICA = "Não foi possível concluir agora. Tente de novo em alguns minutos.";
const TECNICO = /anthropic|gemini|openai|groq|apify|tubular|supabase|postgres|\{"|"type"|error:|typeerror|referenceerror|stack|at \/|\.js:\d|fetch failed|econn|status \d{3}/i;

export function mensagemErro(j, padrao = GENERICA) {
  const bruto = typeof j === "string" ? j : j?.error || j?.fatal || j?.message;
  // um `error` objeto (rota antiga a devolver o corpo do provedor) é técnico por definição
  if (!bruto || typeof bruto !== "string") return padrao;
  const txt = String(bruto).trim();
  if (TECNICO.test(txt) || txt.length > 280) return j?.ref ? `${padrao} (código ${j.ref})` : padrao;
  return j?.ref ? `${txt} (código ${j.ref})` : txt;
}
