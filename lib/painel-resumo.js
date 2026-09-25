import { unstable_cache } from "next/cache";
import { SUPABASE_URL } from "./auth";
import { supabaseServer } from "./supabase";
import { createPainelLoader } from "./painel-data";

const load = createPainelLoader({ db: supabaseServer, cache: unstable_cache, cacheKey: SUPABASE_URL });

// O dia UTC faz parte da chave: a virada do dia não reutiliza o total de ontem.
export function painelResumo(hoje = new Date().toISOString().slice(0, 10)) {
  return load(hoje);
}
