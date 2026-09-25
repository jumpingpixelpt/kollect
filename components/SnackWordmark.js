// "by SNACK" do lockup: o wordmark é a marca em imagem, não texto.
// Duas versões porque o logo original é branco sobre preto — o positivo (letras
// escuras) serve o tema claro, o negativo o escuro. A troca é por CSS e não por
// hook: isto roda em server components e não pode depender do tema em JS.
// Os dois PNG são recortes de public/brand/snack_logo.jpeg (o logo original em
// quadrado preto), com o fundo passado a transparente e as letras recoloridas.
export default function SnackWordmark({ className }) {
  return (
    <span className={`snack-wm${className ? ` ${className}` : ""}`}>
      by
      <img className="wm-neg" src="/brand/snack_wordmark_negativo.png" alt="Snack" />
      <img className="wm-pos" src="/brand/snack_wordmark_positivo.png" alt="Snack" />
    </span>
  );
}
