"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/auth";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [esqueci, setEsqueci] = useState(false);
  const [aviso, setAviso] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErro("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setErro(error.message === "Invalid login credentials" ? "Credenciais inválidas." : `Não foi possível entrar: ${error.message}`);
      setBusy(false);
      return;
    }
    // navegação completa (não client-side) pro middleware ler os cookies novos
    window.location.assign("/");
  }

  // Recuperação por e-mail. O link do e-mail aterra em /recuperar. A resposta é a mesma
  // exista ou não a conta — não se confirma a ninguém que e-mails estão registados.
  // Entrega depende do e-mail do projeto Supabase (ver o aviso no ecrã de utilizadores):
  // sem SMTP próprio, o admin gera o link à mão em /admin e é isso que a mensagem sugere.
  async function recuperar(e) {
    e.preventDefault();
    if (busy) return;
    const alvo = email.trim();
    if (!alvo.includes("@")) return setErro("Escreve o teu e-mail no campo acima.");
    setBusy(true); setErro(""); setAviso("");
    await supabaseBrowser().auth.resetPasswordForEmail(alvo, { redirectTo: `${window.location.origin}/recuperar` }).catch(() => {});
    setAviso("Se existir uma conta com este e-mail, vais receber um link para definir a palavra-passe. Se não chegar em alguns minutos, pede ao administrador um link de recuperação.");
    setBusy(false);
  }

  return (
    <form onSubmit={esqueci ? recuperar : submit}>
      <div className="login-field">
        <label className="login-label" htmlFor="email">E-mail</label>
        <input
          id="email" type="email" required autoFocus autoComplete="username"
          className="login-input" placeholder="nome@snack.com.br"
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {!esqueci && (
        <div className="login-field">
          <label className="login-label" htmlFor="password">Palavra-passe</label>
          <input
            id="password" type="password" required autoComplete="current-password"
            className="login-input" placeholder="••••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      <button type="submit" className="gold-btn login-btn" disabled={busy}>
        {busy ? (esqueci ? "A enviar…" : "A entrar…") : (esqueci ? "Enviar link de recuperação" : "Entrar")}
      </button>
      <button type="button" className="login-alt" onClick={() => { setEsqueci((v) => !v); setErro(""); setAviso(""); }}>
        {esqueci ? "← Voltar ao login" : "Esqueci a palavra-passe"}
      </button>
      {aviso && <p className="login-ok">{aviso}</p>}
      {erro && <p className="login-err">{erro}</p>}
    </form>
  );
}
