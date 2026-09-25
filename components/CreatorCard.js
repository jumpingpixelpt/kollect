import Link from "next/link";
import { TERRITORIO_LABEL } from "@/lib/territorio";
import { CONCEITO } from "@/lib/conceitos";
import ScoreAvatar from "./ScoreAvatar";
import { r2 } from "@/lib/numeros";

const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k" : String(Math.round(n));
// taxa de engajamento = engajamentos ÷ views (lib/engagement.js), em %; null quando a rede
// ainda não foi medida — nunca se inventa a partir dos seguidores
const pct = (x) => (x == null ? "—" : `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

// Três tags e sem nota (feedback do cliente, set/2026; decisão do Rui de 11/09 para as
// vistas internas também): KOL, Rising Star e Pool — Pool é Hidden Gem, Brand Safe
// Performer e elegível sem classe. Sem classe (inelegível ou por calcular) não há badge.
const CLASSE = {
  kol: { label: "KOL", tone: "kol" },
  rising_star: { label: "Rising Star", tone: "rising" },
  hidden_gem: { label: "Pool", tone: "promissora" },
  brand_safe_performer: { label: "Pool", tone: "promissora" },
  elegivel: { label: "Pool", tone: "promissora" },
};

export default function CreatorCard({ c, rank }) {
  // crescimento a 30 dias e forecast saíram do cartão (pedido de 03/09): ficam seguidores e
  // taxa de engajamento; o resto continua na ficha
  // sem nicho escrito pela IA, o cartão ficava sem linha nenhuma de conteúdo: o território
  // é a classificação que toda a creator tem, e é por ela que se filtra
  const nicho = c.top_nicho
    ? `${c.top_nicho.nicho.split(/[&/|]/)[0].trim().slice(0, 18)} · ${r2(c.top_nicho.pct)}%`
    : (c.niche || TERRITORIO_LABEL[c.territorio] || null);
  const cl = CLASSE[c.classe];

  return (
    <Link href={`/creator/${c.id}`} className="card">
      {/* o selo explica-se ao passar o rato (lib/conceitos.js): "janela" não é palavra que se adivinhe */}
      {c.janela_aberta && <span className="badge badge-janela dica dica-dir" data-dica={CONCEITO.janela} tabIndex={0}>◈ Janela</span>}
      {/* acerto da busca por tema: entrou pelo conteúdo, não pelo nome — o card diz isso,
          senão a lista parecia ter errado ao mostrar quem não tem a palavra no nome */}
      {c.tema_sim != null && (
        <span className={`badge badge-tema${c.janela_aberta ? " badge-2" : ""}`}
          title={`Conteúdo próximo do tema buscado · ${Math.round(c.tema_sim * 100)}%`}>≈ tema</span>
      )}

      {/* Um número só, e é o MESMO que a ficha mostra: o Score KOL do briefing (§8), que a
          view leaderboard expõe como escalar em `kol_nota` — trazer o JSON do kol_score para
          as 1.773 linhas da grelha era o payload que o 64cc716 resolveu.

          Mostrava aqui o `kol_index`, o score composto do screening, e por isso o card dizia
          87 onde a ficha dizia 86; no @wesjobs dizia 86 onde a ficha diz 94,9. Sem fallback
          para c.total — é a terceira régua, e emprestá-la fazia o card afirmar uma nota que
          não é a dele. Sem nota, o motivo distingue "inelegível" de "ainda não calculado",
          que não são a mesma coisa. A ordenação em lib/radar-data.js acompanha esta régua. */}
      {/* No Hub a nota interna não é exibida; os requisitos pertencem ao resultado do briefing. */}
      <ScoreAvatar avatar={c.avatar_url} id={c.id} nome={c.name || c.handle} semNota score={c.kol_nota ?? null}
        motivo={c.kol_estado === "inelegivel"
          ? "Inelegível: não cruza os cortes do briefing — ver o dossiê"
          : "Score KOL ainda não calculado para este creator"} />

      <div className="name">{c.name}</div>
      <div className="handle">@{c.handle}</div>

      {/* Nicho principal em destaque */}
      {nicho && <div className="niche-tag">{nicho}</div>}

      {/* Classe única (mutuamente exclusivas no modelo v2), com ícone característico */}
      {cl && <div className={`class-badge tone-${cl.tone}`}>{cl.label}</div>}

      {c.camp && (
        <div className={`camp-line camp-${c.camp.status}`}>
          ✦ {c.camp.status === "aprovada" ? "Aprovada pra campanha" : c.camp.status === "em_estudo" ? "Em estudo" : c.camp.status === "descartada" ? "Descartada" : "Sugerida"} no briefing
        </div>
      )}

      {/* O rodapé do cartão é a bio (pedido de 03/09): alcance e engajamento saíram — a frase
          que o creator escreve de si diz mais à primeira vista, e é por ela que se vê quem é
          salão, clínica ou loja. Os números continuam na vista em lista e na ficha. */}
      {c.bio && <p className="bio" title={c.bio}>{c.bio}</p>}
    </Link>
  );
}
