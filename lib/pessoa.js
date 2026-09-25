// MESMA PESSOA EM DUAS REDES — ligação automática na promoção (set/2026).
//
// O Alan Vivian entrou duas vezes no radar: @alan_vivian (Instagram, 1,7 M) e
// @cabeleireirocalvo (TikTok, 3 M), com a mesma bio palavra por palavra, cada um com o seu
// Score KOL e a sua classe. A base já sabia agrupar contas da mesma pessoa (person_key: cartão
// único com alcance somado, ficha com scorecard por rede), mas só quem corresse
// /api/link-person à mão ligava alguma coisa — e ninguém corria. A 03/09 havia 6 pares assim.
//
// Três sinais chegam para ligar sem perguntar: o mesmo id de creator na Tubular (a Tubular
// identifica a PESSOA, com as redes dela por baixo — os 6 pares de 03/09 vinham todos do
// mesmo id, promovidos uma vez por rede), a bio idêntica (normalizada, ≥ 30 caracteres — duas
// pessoas diferentes não escrevem a mesma bio) e o @ idêntico tirando pontuação e os sufixos
// "oficial"/"official" (@luna_hengel e @lunahengel). O nome sozinho NÃO chega: "Eduarda Silva"
// existe em três contas de pessoas diferentes. E "a bio menciona o outro @" também não: a
// @thalita.portela menciona a @bhulmannbr, que é a marca que a patrocina, não ela.
import { fold } from "./text.js";

const normBio = (s) => fold(String(s || "")).replace(/\s+/g, " ").trim();
const normHandle = (h) => fold(String(h || "")).replace(/(oficial|official)$/g, "").replace(/[^a-z0-9]+/g, "");

/**
 * Procura, noutra plataforma, uma conta que seja a mesma pessoa e partilha o person_key.
 * Devolve { ligado_a: handle, person_key } ou null. Nunca lança — a promoção não pode
 * falhar por causa de um complemento.
 */
export async function ligarMesmaPessoa(db, { id, handle, platform, bio, tubular_id = null }) {
  try {
    const bioN = normBio(bio);
    const hN = normHandle(handle);
    // ids "apify-…" e "ic_…" são sintéticos, um por conta — não identificam pessoa
    const tid = tubular_id && !/^(apify|ic_)/.test(String(tubular_id)) ? String(tubular_id) : null;
    const { data: outros } = await db.from("creators")
      .select("id, handle, platform, bio, person_key, tubular_id")
      .neq("platform", platform).neq("id", id).limit(5000);
    const par = (outros || []).find((o) =>
      (tid && String(o.tubular_id) === tid) ||
      (bioN.length >= 30 && normBio(o.bio) === bioN) || (hN.length >= 5 && normHandle(o.handle) === hN));
    if (!par) return null;
    const key = par.person_key || String(par.handle).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await db.from("creators").update({ person_key: key }).in("id", [id, par.id]);
    return { ligado_a: par.handle, person_key: key };
  } catch {
    return null;
  }
}
