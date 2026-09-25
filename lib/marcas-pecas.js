// Ligação de marcas já identificadas às peças do banco — a régua do backfill
// /api/marcas-pecas (feedback do cliente, set/2026, ponto 16). Vive aqui para ser testável
// sem next/server.
import { fold } from "./text.js";

export const norm = (s) => fold(String(s || "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Peças de `videos` em que a marca (ou o trecho de evidência) aparece.
 * @param marca  { marca, evidencia? }
 * @param videos [{ url, txt (já normalizado), posted_at, views }]
 */
export function ligarPecas(marca, videos) {
  const nome = norm(marca.marca);
  if (nome.length < 3) return [];
  const ev = norm(marca.evidencia).slice(0, 40);
  const tokens = nome.split(" ").filter((t) => t.length >= 3);
  const bate = (txt) => {
    if (!txt) return false;
    if (txt.includes(nome)) return true;
    if (ev.length >= 12 && txt.includes(ev)) return true;
    // marcas compostas ("L'Oréal Paris Elseve"): todos os tokens longos presentes
    return tokens.length > 1 && tokens.every((t) => txt.includes(t));
  };
  return videos
    .filter((v) => v.url && bate(v.txt))
    .map((v) => ({ url: v.url, data: v.posted_at || null, views: v.views || 0 }))
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
}
