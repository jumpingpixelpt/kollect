// Monograma dos Direcionais, compartilhado pelo menu, mobile e login.
export default function KollectMark({ size = 40, className, style }) {
  return (
    <img
      src="/brand/kollect-mark.svg"
      alt="KOLLECT"
      className={className}
      width={size}
      height={size}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    />
  );
}
