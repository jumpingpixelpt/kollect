"use client";
import AvatarImg from "@/components/AvatarImg";

/**
 * Avatar das linhas do briefing. Antes, imagem morta (404 do /api/thumb?sf=1) fazia o
 * <img> desaparecer — no briefing a posição (№) é que marca a linha e a bola da estrela
 * lia-se como avatar. Desde a rodada 2 (B4, set/2026) a foto vem da cópia durável por
 * creator (lib/avatar-src.js) e, se mesmo assim faltar, mostra-se a inicial do nome no
 * mesmo círculo: a lista fica uniforme e nunca aparece a estrela.
 */
export default function BriefAvatar({ src, nome }) {
  if (!src) return null;
  return <AvatarImg src={src} nome={nome} size={52} className="davatar" classeInicial="davatar davatar-empty" />;
}
