// Travão de frequência por utilizador para rotas que gastam dinheiro ou CPU a cada pedido
// (pentest set/2026: "Missing Rate Limiting" em evaluate, creator-embeddings…; "Uncontrolled
// Resource Consumption" em transcribe-casting, deep-scan…).
//
// É um balde por processo: a Vercel (Fluid Compute) reutiliza a instância entre pedidos, por
// isso trava o abuso de um utilizador que martela a mesma rota, sem precisar de Redis. Não é
// contabilidade exacta entre regiões/instâncias — para isso há o orçamento por vendor
// (lib/ic-budget.js) e os tectos de `limite`/`n` das próprias rotas. Aqui o objetivo é que uma
// sessão (ou um script com o CRON_SECRET roubado) não consiga disparar centenas de análises
// pagas num minuto.
//
// Chave: id do utilizador da sessão quando existe, senão o bearer/IP. Uso numa rota:
//
//   const travado = await limitar(req, { rota: "evaluate", max: 20, janelaMs: 60_000 });
//   if (travado) return travado;               // 429 já montado, com Retry-After
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON } from "./auth";

const baldes = new Map(); // chave → { inicio, n }
const MAX_CHAVES = 5000;

async function chaveDoPedido(req) {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return "bearer";
  try {
    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
    const { data: { user } } = await sb.auth.getUser();
    if (user?.id) return `user:${user.id}`;
  } catch {}
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
  return `ip:${ip}`;
}

/** Devolve null se o pedido passa; senão a resposta 429 pronta a devolver. */
export async function limitar(req, { rota, max = 30, janelaMs = 60_000 } = {}) {
  const agora = Date.now();
  const quem = await chaveDoPedido(req);
  // crons, drains e orquestradores chamam as rotas irmãs com o bearer, dezenas por minuto
  // por desenho (atualizar-lote, enrich): o travão é para sessões, não para o sistema.
  if (quem === "bearer") return null;
  const chave = `${rota}|${quem}`;
  let b = baldes.get(chave);
  if (!b || agora - b.inicio >= janelaMs) {
    if (baldes.size >= MAX_CHAVES) baldes.clear();
    b = { inicio: agora, n: 0 };
    baldes.set(chave, b);
  }
  b.n += 1;
  if (b.n <= max) return null;
  const espera = Math.max(1, Math.ceil((b.inicio + janelaMs - agora) / 1000));
  return NextResponse.json(
    { error: "demasiados pedidos", detalhe: `limite de ${max} por ${Math.round(janelaMs / 1000)} s nesta rota — tente de novo em ${espera} s` },
    { status: 429, headers: { "Retry-After": String(espera) } }
  );
}
