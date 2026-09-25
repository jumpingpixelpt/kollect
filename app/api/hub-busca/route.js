import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabase";
import { fold } from "@/lib/text";
import { erroPublico } from "@/lib/erro-publico";
import { exigirSessao } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Busca do Creators Hub FORA da lista analisada (feedback rodada 2, F3.2 — set/2026).
 *
 * O cliente disse que «os principais creators não aparecem». A causa: a busca do Hub corre
 * sobre a lista montada a partir da vista `leaderboard` (~5,2 mil creators analisados), e a
 * base de descoberta (`prospects`, ~68,5 mil) ficava de fora — @camilacoelho (17,8 M) e
 * @marimaria (36 M) estão em prospects e a busca devolvia, no máximo, homónimos pequenos.
 * A vista também faz INNER JOIN a `scores`: um creator acabado de entrar, sem score, era
 * invisível. A vista não se altera (base partilhada, decisão de set/2026); esta rota cobre
 * as duas lacunas por fora, e o Hub mostra-as em blocos próprios por baixo da lista:
 *
 *   GET ?q=<nome ou @>   (≥ 2 caracteres)
 *   → { q, sem_score: [...], prospects: [...] }
 *
 *   sem_score  creators da tabela `creators` que casam e NÃO estão na `leaderboard`
 *              (sem score ainda) — «sem análise completa».
 *   prospects  a base de descoberta, até 20, por seguidores, sem os que já viraram creator.
 *              A ligação prospect→creator é a mesma de /descobertas: por tubular_id E por @
 *              (o @ é UNIQUE em creators e casa em qualquer plataforma), e os estados de
 *              lote que dizem «já está no radar» ficam de fora.
 *
 * Índices trigram em prospects.name_norm e prospects.handle (migração
 * 202609210030_prospects_busca_trgm): sem eles, cada tecla varria a tabela (189 ms medidos).
 * O @ procura-se sem espaços («camila coelho» também acha @camilacoelho).
 */

const MAX_PROSPECTS = 20;
const MAX_SEM_SCORE = 12;
// estados que querem dizer «não mostrar como candidato» — os mesmos de /descobertas
const FORA = ["promovido", "substituida_ic"];
const FORA_PREFIXO = ["sem_handle:irrecuperavel", "ja_no_radar:", "duplicado_handle:"];

// Só letras, números, ponto, sublinhado e espaço: o texto entra num filtro `or` do
// PostgREST, onde vírgulas e parênteses são sintaxe.
const limpar = (s) => fold(String(s ?? "")).replace(/^@+/, "").replace(/[^\p{L}\p{N}._ ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);

export async function GET(req) {
  const bloqueio = await exigirSessao(req);
  if (bloqueio) return bloqueio;
  try {
    const t = limpar(new URL(req.url).searchParams.get("q"));
    if (t.length < 2) return NextResponse.json({ q: t, sem_score: [], prospects: [] });
    const h = t.replace(/\s+/g, "");
    const [semScore, prospects] = await Promise.all([buscarSemScore(t, h), buscarProspects(t, h)]);
    return NextResponse.json({ q: t, sem_score: semScore, prospects });
  } catch (e) {
    return NextResponse.json(erroPublico(e, "hub-busca"), { status: 200 });
  }
}

async function buscarSemScore(t, h) {
  const { data, error } = await supabase.from("creators")
    .select("id, name, handle, platform, followers, avatar_url")
    .or(`handle.ilike."%${h}%",name.ilike."%${t}%"`)
    .order("followers", { ascending: false, nullsFirst: false })
    .limit(60);
  if (error) throw new Error(`hub-busca creators: ${error.message}`);
  if (!data?.length) return [];
  const { data: noLb, error: e2 } = await supabase.from("leaderboard").select("id").in("id", data.map((c) => c.id));
  if (e2) throw new Error(`hub-busca leaderboard: ${e2.message}`);
  const lb = new Set((noLb ?? []).map((r) => r.id));
  return data.filter((c) => !lb.has(c.id)).slice(0, MAX_SEM_SCORE);
}

async function buscarProspects(t, h) {
  let q = supabase.from("prospects")
    .select("tubular_id, name, handle, platform, followers, thumbnail, genre, status")
    .or(`name_norm.ilike."%${t}%",handle.ilike."%${h}%"`)
    .not("handle", "is", null);
  for (const s of FORA) q = q.neq("status", s);
  for (const p of FORA_PREFIXO) q = q.not("status", "like", `${p}%`);
  const { data, error } = await q.order("followers", { ascending: false, nullsFirst: false }).limit(80);
  if (error) throw new Error(`hub-busca prospects: ${error.message}`);
  if (!data?.length) return [];

  // quem já virou creator (por tubular_id ou por @) sai — está na lista de cima
  const ids = data.map((p) => p.tubular_id);
  const handles = [...new Set(data.map((p) => p.handle.toLowerCase()))];
  const [{ data: porId }, { data: porHandle }] = await Promise.all([
    supabase.from("creators").select("tubular_id").in("tubular_id", ids),
    supabase.from("creators").select("handle").in("handle", handles),
  ]);
  const idsCreator = new Set((porId ?? []).map((c) => c.tubular_id));
  const handlesCreator = new Set((porHandle ?? []).map((c) => (c.handle || "").toLowerCase()));

  // o mesmo @ pode vir de várias descobertas: fica a linha com mais seguidores (a 1ª)
  const vistos = new Set();
  const out = [];
  for (const p of data) {
    const hh = p.handle.toLowerCase();
    if (idsCreator.has(p.tubular_id) || handlesCreator.has(hh) || vistos.has(`${p.platform}:${hh}`)) continue;
    vistos.add(`${p.platform}:${hh}`);
    out.push({
      tubular_id: p.tubular_id, name: p.name, handle: p.handle, platform: p.platform,
      followers: p.followers, thumbnail: p.thumbnail, genre: p.genre,
    });
    if (out.length >= MAX_PROSPECTS) break;
  }
  // @ exacto à cabeça: quem escreve «@marimaria» quer a @marimaria, não a maior conta
  // que contém o texto
  return out.sort((a, b) => (b.handle.toLowerCase() === h) - (a.handle.toLowerCase() === h));
}
