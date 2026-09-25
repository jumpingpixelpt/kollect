import { NextResponse } from "next/server";
import { internalJson } from "@/lib/internal-fetch";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { saldoConhecido, PISO, PISO_VIDEOS } from "@/lib/tubular-quota";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron de descoberta — 05:00, uma hora antes do /api/cron/collect.
 *
 * A ordem importa: o que se descobre às 05:00 entra na coleta das 06:00 do mesmo dia, em vez
 * de esperar 24 horas pela primeira medição.
 *
 * OS TRÊS TERRITÓRIOS NA MESMA CORRIDA — o mesmo que o botão de /descobertas faz.
 *
 * Até 29/07 isto rodava UM território por dia (beauty → health → lifestyle), derivado da data.
 * A razão era o custo: com a página fixa de 200 vídeos, varrer os três de uma vez custava
 * 5.220 unidades contra 820 de um só. Essa razão desapareceu quando a página passou a ser
 * dimensionada à fatia de cada consulta — com os defaults deste cron (max=200, ambas as
 * plataformas) os três custam 1.320 unidades, contra 820 do beauty sozinho e 620 de cada um
 * dos outros dois. Três territórios por 1,6× do preço do mais caro, e não por 6,4× como era
 * com a página fixa: a rotação deixou de comprar o que a justificava.
 *
 * E tinha um custo que não estava à vista: com ela, cada território era visto de três em três
 * dias, e a janela de descoberta são exactamente 3 dias. Os 3 dias existem para dar folga a um
 * dia falhado do cron (ver /api/discover-tubular) — folga que a rotação consumia inteira, e um
 * dia falhado abria buraco de cobertura a sério. Dois terços do funil ficavam parados em
 * qualquer dia, e o painel de /descobertas prometia ao operador um "varrimento completo" às
 * 05:00 que não acontecia. Os dois passam a correr os mesmos parâmetros — territórios,
 * plataformas e tecto — e o texto do painel passa a dizer isso.
 *
 *   GET ?territorio=  força um só território (beauty|health|lifestyle); omisso varre todos
 *       ?max=         tecto de creators
 *       ?semresolve=1 só descobre, não resolve handles
 *       ?dry=1        estima e não gasta
 *
 * O tecto é em CREATORS, e o guard de quota do lib/tubular-quota.js converte-o em unidades
 * antes de deixar correr. A quota da Tubular é mensal e não transita: sobra a 31 evapora-se,
 * o que justifica varrer mais no fim do mês, não menos.
 */
export async function GET(req) {
  try { return await run(req); }
  catch (e) { return NextResponse.json({ fatal: String(e).slice(0, 400) }, { status: 200 }); }
}
export const POST = GET;

async function run(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const chave = sp.get("territorio") || "todos";
  const plataforma = sp.get("plataforma") || "ambas";
  // 200 creators por dia — o mesmo tecto do botão de /descobertas. Não é o travão do custo
  // (esse é a página por consulta, e o `max` só paga 0,1 unidade por creator graduado): é a
  // quantidade que o operador consegue mesmo triar num dia. Descobrir mais do que isso enche
  // /descobertas de linhas que ninguém olha e gasta vídeos únicos — o tecto mensal mais
  // apertado dos dois — a comprar fila em vez de comprar creators.
  const max = Math.min(Number(sp.get("max")) || 200, 1500);
  const dry = !!sp.get("dry");
  const semResolve = !!sp.get("semresolve");
  const base = new URL(req.url).origin;
  const t0 = Date.now();

  const qs = `territorio=${encodeURIComponent(chave)}&plataforma=${encodeURIComponent(plataforma)}&max=${max}${dry ? "&dry=1" : ""}`;
  const desc = await internalJson(`${base}/api/discover-tubular?${qs}`, { nome: "discover-tubular", timeout: 280000 });

  // RESOLVER COM O TEMPO QUE SOBRA, NÃO COM O QUE JÁ PASSOU.
  //
  // O guard era `elapsed < 120s` mais um timeout fixo de 150s — dimensionado para a corrida de
  // um só território. Com os três são 30 chamadas à Tubular em vez de 8 a 16, e como o throttle
  // é de 1,3s e serializado, só ele são 39s; com a latência de cada chamada e o dedup paginado
  // sobre 42 mil prospects, a corrida passa a encostar-se aos 120s. O resolve deixaria de
  // correr na maioria dos dias e os prospects ficariam sem @, que é o que os torna promovíveis.
  // O que interessa é o que FALTA dos 300s desta função, e é isso que se dá.
  //
  // O piso são 120s porque o resolve-handles só arranca um actor do Apify se ele couber
  // inteiro (o `cabe()` de lá: 100s mais folga). Com menos que isso, reclamava a fila para a
  // devolver a seguir sem tentar nada — trabalho de base de dados a troco de zero handles.
  const sobra = () => 285000 - (Date.now() - t0); // 300s de maxDuration menos a cauda da resposta
  let resolve = null;
  if (!dry && !semResolve && desc?.gravados > 0 && sobra() > 120000) {
    // resolve só o que cabe no tempo que sobra; o resto fica em fila para a próxima corrida
    resolve = await internalJson(`${base}/api/resolve-handles?n=60`, { nome: "resolve-handles", timeout: sobra() - 10000 });
  }

  const saldo = await saldoConhecido();

  return NextResponse.json({
    ok: true,
    territorio: chave, territorios: desc?.territorios ?? null, plataforma,
    descoberta: desc,
    handles: resolve,
    quota_tubular: saldo ? { saldo: Math.round(saldo.saldo), limite: saldo.limite, expira: saldo.expira, piso: PISO } : null,
    // tecto independente e mais apertado que o das unidades — é o que a varredura fura
    // primeiro, e o cron é quem corre sem ninguém a olhar
    videos_unicos: saldo?.videos
      ? { restantes: Math.round(saldo.videos.restantes), limite: saldo.videos.limite, expira: saldo.videos.expira, piso: PISO_VIDEOS }
      : null,
    segundos: Math.round((Date.now() - t0) / 1000),
  });
}
