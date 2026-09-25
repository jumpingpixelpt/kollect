import Brand from "@/components/Brand";
import LoginForm from "@/components/LoginForm";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata = { title: "Entrar · KOLLECT by Snack" };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-theme"><ThemeToggle compact /></div>
      <main className="login-card">
        <div className="login-brand"><Brand size={46} /></div>
        <h1 className="login-title">Creator <em>Intelligence</em></h1>
        <p className="login-sub">Acesso reservado à equipa</p>
        <LoginForm />
      </main>
      <footer className="login-foot">KOLLECT by Snack · Radar de rising stars de beauty</footer>
    </div>
  );
}
