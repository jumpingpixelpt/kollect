import Brand from "@/components/Brand";
import RecuperarPassword from "@/components/RecuperarPassword";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Redefinir palavra-passe · KOLLECT by Snack" };
export const dynamic = "force-dynamic";

// Fora do grupo (app), como o /login: sem sidebar, sem sessão obrigatória (ver middleware).
export default function RecuperarPage() {
  return (
    <div className="login-wrap">
      <div className="login-theme"><ThemeToggle compact /></div>
      <main className="login-card">
        <div className="login-brand"><Brand size={46} /></div>
        <h1 className="login-title">Nova <em>palavra-passe</em></h1>
        <p className="login-sub">Define a palavra-passe da tua conta</p>
        <RecuperarPassword />
      </main>
      <footer className="login-foot">KOLLECT by Snack · Radar de rising stars de beauty</footer>
    </div>
  );
}
