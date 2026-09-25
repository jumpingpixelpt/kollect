import PainelPendente from "@/components/PainelPendente";
import Link from "next/link";
import AvatarImg from "@/components/AvatarImg";
import { avatarSrc } from "@/lib/avatar-src";
const fmt = (n) => n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
// classes do §8 (classe8 na query da ficha) — o screening fornece as métricas, não o rótulo
const ICON = { kol: "👑", rising_star: "★", hidden_gem: "💎", brand_safe_performer: "🛡", elegivel: "◇" };

function Row({ c, tag }) {
  const cl = c.classe8;
  return (
    <Link href={`/creator/${c.id}`} className="cmp-row">
      {/* foto durável por id; morta → inicial, nunca a estrela (B4, set/2026) */}
      <AvatarImg src={avatarSrc(c.avatar_url, c.id)} nome={c.name || c.handle} size={34} classeInicial="cmp-av" />
      <span className="cmp-meta">
        <span className="cmp-name">{c.name}</span>
        <span className="cmp-sub">{ICON[cl] || "·"} @{c.handle} · {fmt(c.followers)}</span>
      </span>
      {tag && <span className="cmp-tag">{tag}</span>}
    </Link>
  );
}

export default function ComparableCreators({ similar, self }) {
  const list = (similar || []).filter((c) => c.kol_screen?.metricas?.eng_index != null);
  if (list.length < 2) return <PainelPendente titulo="Comparáveis" sub="pares do mesmo nicho" passo="kol (/api/kol-screen)" nota="Precisa de pelo menos dois creators já avaliados no mesmo nicho e faixa." />;
  const eng = (c) => Number(c.kol_screen?.metricas?.eng_index) || 0;
  const fol = (c) => Number(c.followers) || 0;
  const myFol = self?.followers || 0;

  const kols = list.filter((c) => ["kol", "rising_star"].includes(c.classe8)).sort((a, b) => eng(b) - eng(a)).slice(0, 3);
  const cheaper = list.filter((c) => fol(c) < myFol * 0.7).sort((a, b) => eng(b) - eng(a))[0];
  const bigger = list.filter((c) => fol(c) > myFol * 1.5).sort((a, b) => fol(b) - fol(a))[0];
  const tutorial = list.find((c) => (c.kol_screen?.defesa || []).some((d) => /especialista|muito forte/.test(d.resultado)) && c.id !== kols[0]?.id);

  return (
    <div className="panel">
      <h3>Comparable Creators <span>· alternativas de casting</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> outros creators do mesmo território — pra montar casting, achar alternativa mais barata ou de mais alcance. <b>Por que acompanhar:</b> a marca não compra um creator isolado, compra opções.
      </div>
      {kols.length > 0 && <div className="cmp-group"><div className="cmp-gl">Similar KOLs / Rising</div>{kols.map((c) => <Row key={c.id} c={c} />)}</div>}
      {cheaper && <div className="cmp-group"><div className="cmp-gl">Alternativa mais barata</div><Row c={cheaper} tag="menor base" /></div>}
      {bigger && <div className="cmp-group"><div className="cmp-gl">Alternativa de mais alcance</div><Row c={bigger} tag="base maior" /></div>}
    </div>
  );
}
