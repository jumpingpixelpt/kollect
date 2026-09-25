// Supabase trava em 1000 linhas por request — pagina pra carregar TODAS.
//
// Vivia dentro de lib/radar-data.js, que é o módulo da lista do radar: importa o cliente
// do servidor, o forecast, as regras de marca e mantém um cache de processo com TTL.
// Quem só precisa de paginar — o cron de coleta, por exemplo — não deve arrastar nada
// disso, e muito menos o cache. O radar-data reexporta daqui, portanto continua a haver
// uma única implementação.
export const fetchAllRows = async (build, { strict = false } = {}) => {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    // As telas que precisam do conjunto completo não devem mostrar uma página
    // parcial como se estivesse pronta caso uma leitura intermediária falhe.
    if (strict && (error || !Array.isArray(data))) throw new Error("Não foi possível carregar todos os registros");
    if (error || !data?.length) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
};
