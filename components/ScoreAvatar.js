import AvatarImg from "@/components/AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";

// `score` pode vir vazio: só existe depois do passo `kol` da cadeia. Sem ele, o anel fica
// no traço de fundo e a pastilha mostra "—" em vez de um número.
//
// Antes a página caía para o Radar Score (c.total) quando o kol_screen ainda não existia,
// e logo a seguir à importação esse valor é o placeholder do RPC ingest_profile
// (eng_rate × 1.6). O avatar mostrava 4, depois 48 — não é o mesmo número a melhorar, são
// três réguas diferentes no mesmo círculo. Um creator por avaliar não tem nota; dizê-lo é
// mais honesto do que emprestar a de outro motor.
// `motivo` explica no tooltip PORQUE não há nota. Sem ele havia uma só explicação possível
// ("ainda não calculado"), e desde que o anel passou a mostrar o Score KOL do briefing há
// duas: não foi calculado, ou foi e o creator não cruza os cortes de elegibilidade. As duas
// dão "—" no anel e não são a mesma coisa.
// Foto morta cai SEMPRE para a inicial do nome (components/AvatarImg.js). Os cartões do
// radar mantinham de propósito a estrela genérica do /api/thumb; o cliente leu-a como
// "creator sem foto"/erro (feedback rodada 2, B4, set/2026) e ela saiu de todo o lado.
// `id` (do creator): pede a cópia durável thumbs/avatars/<id>.jpg (lib/avatar-src.js).

// `semNota` (feedback do cliente, set/2026): a ficha não mostra a nota — nem pastilha nem
// anel preenchido. A foto fica com o traço de fundo, como um avatar normal.
export default function ScoreAvatar({ avatar, id, score, size = 96, motivo, nome, semNota = false }) {
  const r = 48, c = 2 * Math.PI * r;
  const n = score == null || score === "" || !Number.isFinite(Number(score)) ? null : Number(score);
  const pct = n == null || semNota ? 0 : Math.min(n / 100, 1);
  const src = avatarSrc(avatar, id);
  return (
    <div className="avatar-ring" style={{ width: size, height: size }}>
      <svg className="ring" viewBox="0 0 104 104" width="100%" height="100%">
        <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(212,175,55,0.15)" strokeWidth="2.5" />
        <circle cx="52" cy="52" r={r} fill="none" stroke="url(#au)" strokeWidth="2.5"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" />
        <defs>
          <linearGradient id="au" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9a7b1e" />
            <stop offset="100%" stopColor="#f0d77b" />
          </linearGradient>
        </defs>
      </svg>
      <AvatarImg src={src} nome={nome} size={size} />
      {!semNota && (
        <div className={`score-pill${n == null ? " score-pill-vazio" : ""}`}
          title={n == null ? (motivo || "Score KOL ainda não calculado — corre depois do screening na cadeia de enriquecimento") : undefined}>
          {n == null ? "—" : n.toFixed(0)}
        </div>
      )}
    </div>
  );
}
