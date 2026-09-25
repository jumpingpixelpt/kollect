import { NextResponse } from "next/server";
import { autorizadoAdmin, SO_ADMIN } from "@/lib/api-auth";
import { refrescarRadarCache } from "@/lib/radar-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron de 5 em 5 minutos (vercel.json): remonta a base do Creators Hub e grava-a em
 * `radar_cache` (lib/radar-cache.js). É o que mantém a primeira visita de cada instância
 * barata — lê a linha pronta em vez de montar ~10 MB pela RPC radar_base.
 * Só leitura da base viva + uma escrita na tabela de cache; não chama serviços pagos.
 * → { ok, linhas, bytes, montagem_ms } · erro: { error } com HTTP 200 (convenção das rotas).
 */
export async function GET(req) {
  if (!(await autorizadoAdmin(req))) return NextResponse.json(SO_ADMIN, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await refrescarRadarCache()) });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) });
  }
}
