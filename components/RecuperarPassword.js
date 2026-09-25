"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/auth";

/**
 * Define uma palavra-passe nova a partir de um link de recuperação.
 *
 * Aceita os três formatos em que um link pode chegar:
 *  - ?token_hash=…&type=recovery  — o link que o admin gera em /admin (generateLink). Não
 *    passa por e-mail nem por redirect do Supabase: a página troca o token por sessão com
 *    verifyOtp. É o caminho que funciona sem SMTP e em qualquer browser.
 *  - ?code=…                      — o link do e-mail "Esqueci a palavra-passe" aberto no
 *    mesmo browser que o pediu (PKCE).
 *  - #access_token=…              — o mesmo e-mail aberto noutro browser (fluxo implícito);
 *    o cliente do Supabase apanha-o sozinho ao arrancar.
 *
 * Com sessão estabelecida, updateUser({ password }) grava a nova e a pessoa segue para a
 * app com a sessão já feita — sem voltar a escrever a password que acabou de definir.
 */
const MIN = 8;

export default function RecuperarPassword() {
  const [estado, setEstado] = useState("a verificar"); // a verificar | pronto | invalido | gravado
  const [motivo, setMotivo] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const sb = useRef(null);

  useEffect(() => {
    const cliente = supabaseBrowser();
    sb.current = cliente;
    let vivo = true;
    // o fluxo implícito (#access_token) chega por aqui: o cliente processa o hash ao arrancar
    const { data: sub } = cliente.auth.onAuthStateChange((evento, sessao) => {
      if (vivo && sessao && (evento === "PASSWORD_RECOVERY" || evento === "SIGNED_IN" || evento === "INITIAL_SESSION")) setEstado("pronto");
    });
    (async () => {
      const url = new URL(window.location.href);
      const tokenHash = url.searchParams.get("token_hash");
      const code = url.searchParams.get("code");
      try {
        if (tokenHash) {
          const { error } = await cliente.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
          if (error) throw error;
          if (vivo) setEstado("pronto");
        } else if (code) {
          const { error } = await cliente.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (vivo) setEstado("pronto");
        } else {
          // sem token nem código: ou o hash já foi processado, ou a pessoa já tinha sessão
          const { data: { session } } = await cliente.auth.getSession();
          if (vivo) {
            if (session) setEstado("pronto");
            else if (!window.location.hash.includes("access_token")) { setEstado("invalido"); setMotivo("Este endereço não traz nenhum link de recuperação."); }
          }
        }
        // limpa o token da barra de endereço: não fica no histórico nem em capturas de ecrã
        window.history.replaceState({}, "", "/recuperar");
      } catch (e) {
        if (vivo) { setEstado("invalido"); setMotivo(/expired|invalid|not found/i.test(String(e?.message)) ? "O link expirou ou já foi usado." : String(e?.message || e)); }
      }
    })();
    return () => { vivo = false; sub?.subscription?.unsubscribe(); };
  }, []);

  async function gravar(e) {
    e.preventDefault();
    if (busy) return;
    if (p1.length < MIN) return setErro(`A palavra-passe precisa de pelo menos ${MIN} caracteres.`);
    if (p1 !== p2) return setErro("As duas palavras-passe não coincidem.");
    setBusy(true); setErro("");
    const { error } = await sb.current.auth.updateUser({ password: p1 });
    if (error) { setErro(`Não foi possível gravar: ${error.message}`); setBusy(false); return; }
    setEstado("gravado");
    // navegação completa para o middleware ler os cookies da sessão nova
    setTimeout(() => window.location.assign("/"), 1200);
  }

  if (estado === "a verificar") return <p className="login-sub" style={{ marginTop: 24 }}>A validar o link…</p>;

  if (estado === "invalido") {
    return (
      <div style={{ marginTop: 20 }}>
        <p className="login-err">{motivo || "Link inválido."}</p>
        <p className="login-sub" style={{ marginTop: 14 }}>
          Pede ao administrador um novo link de recuperação, ou usa "Esqueci a palavra-passe" no{" "}
          <a href="/login" className="login-alt">ecrã de entrada</a>.
        </p>
      </div>
    );
  }

  if (estado === "gravado") return <p className="login-ok" style={{ marginTop: 24 }}>Palavra-passe gravada. A entrar…</p>;

  return (
    <form onSubmit={gravar}>
      <div className="login-field">
        <label className="login-label" htmlFor="p1">Nova palavra-passe</label>
        <input id="p1" type="password" required minLength={MIN} autoFocus autoComplete="new-password"
          className="login-input" placeholder={`mínimo ${MIN} caracteres`} value={p1} onChange={(e) => setP1(e.target.value)} />
      </div>
      <div className="login-field">
        <label className="login-label" htmlFor="p2">Repete a palavra-passe</label>
        <input id="p2" type="password" required minLength={MIN} autoComplete="new-password"
          className="login-input" placeholder="a mesma, outra vez" value={p2} onChange={(e) => setP2(e.target.value)} />
      </div>
      <button type="submit" className="gold-btn login-btn" disabled={busy}>{busy ? "A gravar…" : "Gravar e entrar"}</button>
      {erro && <p className="login-err">{erro}</p>}
    </form>
  );
}
