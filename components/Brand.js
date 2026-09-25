// Logo lockup KOLLECT by Snack — marca em SVG (components/KollectMark.js) + wordmark. Clicável -> home. Sem hooks: roda em server components.
import Link from "next/link";
import KollectMark from "@/components/KollectMark";
import SnackWordmark from "@/components/SnackWordmark";

export default function Brand({ size = 40 }) {
  return (
    <Link href="/" className="brand" style={{ textDecoration: "none", color: "inherit" }} aria-label="KOLLECT — início">
      <KollectMark size={size} />
      <div>
        <div
          className="brand-name"
          style={{
            fontFamily: "var(--sans, system-ui, sans-serif)",
            fontWeight: 800,
            fontStyle: "normal",
            letterSpacing: "0.015em",
            lineHeight: 1,
            color: "var(--text, #fff)",
          }}
        >
          KOLLECT
        </div>
        <SnackWordmark className="brand-sub" />
      </div>
    </Link>
  );
}
