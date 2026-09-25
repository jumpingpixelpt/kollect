import { NextResponse } from "next/server";
import { radarData, slimRow } from "@/lib/radar-data";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fatias da lista de creators pro scroll infinito de /creators.
 * GET ?offset=0&limit=20 [+ filtros da barra: q (nome/@handle/categoria), tema=1 (Enter ou
 *                           Buscar: junta os acertos por tema no conteúdo indexado),
 *                           n (território), l (classificação), p (plataforma),
 *                           tier (Nano…Mega, pela maior conta), sn (Creator's Topic),
 *                           fw (faixa antiga de seguidores, só links), b (marca), sort/dir]
 *                        [+ recortes só por URL: c/cs (casting de campanha), ft]
 * → { total, offset, items, tema? } — mesma montagem/ordem do SSR (lib/radar-data).
 *   `tema` só vem com tema=1: { n } acertos além dos de texto, ou { n: 0, erro } quando o
 *   embedding/pgvector falhou — a lista responde na mesma com os acertos por texto.
 *
 * `total` é o do recorte JÁ filtrado: é o que diz ao cliente quando parar de
 * pedir páginas. Enquanto a busca era só no browser, procurar um nome deixava o
 * total nos 1.765 e a sentinela do scroll pedia fatia atrás de fatia (cada uma a
 * remontar a base) atrás de resultados que o servidor nem sabia que filtrava.
 */
export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const sp = Object.fromEntries(new URL(req.url).searchParams);
    const offset = Math.max(0, Number(sp.offset) || 0);
    const limit = Math.min(Math.max(1, Number(sp.limit) || 20), 2000);
    // ?fresh=1 salta o cache de processo — pedido pelo cliente logo após uma mutação
    // (apagar creator), quando servir a cópia em memória mostraria o que já não existe
    const { all, tema } = await radarData(sp, { fresh: sp.fresh === "1" });
    return NextResponse.json({
      total: all.length,
      offset,
      items: all.slice(offset, offset + limit).map(slimRow),
      ...(tema ? { tema } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 200 });
  }
}
