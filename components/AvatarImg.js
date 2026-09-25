"use client";
import { useState } from "react";
import { inicialDe } from "@/lib/avatar-src";

/**
 * Foto do avatar com queda para a INICIAL do nome.
 *
 * As URLs de avatar do Instagram e do TikTok são assinadas e expiram. O /api/thumb guarda
 * uma cópia durável na primeira vez que a serve, mas para quem foi importado antes disso
 * existir a origem já morreu e não há nada a guardar — e aí o proxy devolvia a estrela
 * dourada genérica, que numa ficha se lia como "avatar de sistema" e não dizia de quem era
 * a página. A inicial diz. Pede-se ?sf=1 ao proxy para receber 404 em vez da estrela, e o
 * onError troca a imagem pela letra.
 */
/*
 * Desde a rodada 2 (B4, set/2026) é o avatar de TODA a app: cartões, lista, briefing e
 * Hub pedem a foto por lib/avatar-src.js (?avatar=<id>&sf=1) e caem aqui para a inicial.
 * `className` vai para a <img>; `classeInicial` substitui a classe da letra quando o sítio
 * tem o seu próprio círculo (CSS module); `style` aplica-se às duas formas.
 */
export default function AvatarImg({ src, nome, size = 96, className, classeInicial, style }) {
  const [morta, setMorta] = useState(!src);
  const [srcVisto, setSrcVisto] = useState(src);
  // um src novo (outra linha reaproveitada pelo React) merece nova tentativa
  if (src !== srcVisto) { setSrcVisto(src); setMorta(!src); }
  const inicial = inicialDe(nome);
  if (morta) {
    return (
      <span className={classeInicial || `avatar-inicial${className ? ` ${className}` : ""}`}
        style={{ fontSize: Math.round(size * 0.4), ...style }} role="img" aria-label={nome || "sem foto"}>
        {inicial}
      </span>
    );
  }
  return <img className={className} style={style} src={src} alt="" loading="lazy" onError={() => setMorta(true)} />;
}
