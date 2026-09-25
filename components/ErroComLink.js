"use client";

/** Texto de erro com URLs clicáveis. As rotas de promoção passaram a escrever o link do
 *  perfil dentro da mensagem (pedido do operador: "escreve sempre o url para ser mais
 *  fácil") — como texto puro não é clicável, isto parte a mensagem nos https:// e
 *  transforma cada um num <a>. */
export default function ErroComLink({ texto, style }) {
  const parts = String(texto || "").split(/(https?:\/\/[^\s)"]+)/g);
  return (
    <span style={style}>
      {parts.map((p, i) => /^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>{p}</a>
        : p)}
    </span>
  );
}
