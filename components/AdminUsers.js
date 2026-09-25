"use client";
import { Fragment, useEffect, useState } from "react";

// Gestão de contas (Onda 3). Estilos vivem em globals.css (.adm-*) para seguir a
// identidade do resto da app — o formulário reusa o painel do login e a tabela é a
// mesma do radar (.rl-table).
const fmtData = (s) => (s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [eu, setEu] = useState(null);
  const [msg, setMsg] = useState(null);
  const [erro, setErro] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", papel: "operador" });
  // painel aberto por baixo de uma linha: { id, tipo: "password" | "link", pw, link, email }
  const [painel, setPainel] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // 12 caracteres sem os ambíguos (0/O, 1/l/I): a pessoa vai escrevê-la a partir de uma
  // mensagem, e "l" contra "1" é a chamada de suporte mais estúpida que existe
  const gerarPw = () => {
    const alfa = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const buf = new Uint32Array(12); crypto.getRandomValues(buf);
    return Array.from(buf, (n) => alfa[n % alfa.length]).join("");
  };

  const abrirPassword = (u) => { setErro(null); setMsg(null); setPainel({ id: u.id, tipo: "password", email: u.email, pw: gerarPw() }); };

  const guardarPassword = async () => {
    if (!painel?.pw || painel.pw.length < 8) return setErro("password com pelo menos 8 caracteres");
    setBusy(true); setErro(null); setMsg(null);
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: painel.id, acao: "password", password: painel.pw }) }).then((x) => x.json()).catch(() => ({}));
    if (r.error || r.fatal) setErro(r.error || r.fatal);
    else { setMsg(`Palavra-passe de ${painel.email} alterada — entrega-a por um canal seguro. A sessão que a pessoa tiver aberta continua válida até sair.`); setPainel(null); }
    setBusy(false);
  };

  // O link nasce no servidor (generateLink) e vale 1 hora: quem o tiver define a password
  // da conta, por isso nunca é guardado — só mostrado, para copiar e enviar.
  const gerarLink = async (u) => {
    setBusy(true); setErro(null); setMsg(null); setCopiado(false);
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: u.id, acao: "link_recuperacao" }) }).then((x) => x.json()).catch(() => ({}));
    if (r.error || r.fatal) setErro(r.error || r.fatal);
    else setPainel({ id: u.id, tipo: "link", email: u.email, link: r.link });
    setBusy(false);
  };

  const copiar = async (txt) => {
    try { await navigator.clipboard.writeText(txt); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { setErro("não consegui copiar — seleciona o link e copia à mão"); }
  };

  const load = async () => {
    const r = await fetch("/api/admin/users").then((x) => x.json()).catch(() => ({}));
    if (r.error || r.fatal) setErro(r.error || r.fatal);
    else { setUsers(r.users ?? []); setEu(r.eu ?? null); }
  };
  useEffect(() => { load(); }, []);

  const patch = async (body) => {
    setBusy(true); setErro(null); setMsg(null);
    const r = await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({}));
    if (r.error || r.fatal) setErro(r.error || r.fatal);
    await load(); setBusy(false);
  };

  const criar = async (e) => {
    e.preventDefault();
    setBusy(true); setErro(null); setMsg(null);
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then((x) => x.json()).catch(() => ({}));
    if (r.error || r.fatal) setErro(r.error || r.fatal);
    else { setMsg(`Conta criada: ${form.email} · papel ${r.papel}.`); setForm({ email: "", password: "", papel: "operador" }); }
    await load(); setBusy(false);
  };

  if (users === null) return <div className="empty">{erro || "A carregar utilizadores…"}</div>;

  return (
    <>
      <section className="adm-panel">
        <h2>Nova <span>conta</span></h2>
        <p className="adm-lead">A conta fica ativa de imediato, com o e-mail já confirmado.</p>

        <form onSubmit={criar} className="adm-form">
          <div className="adm-field">
            <label className="adm-label" htmlFor="adm-email">E-mail</label>
            <input id="adm-email" className="adm-input" type="email" required autoComplete="off"
              placeholder="nome@loreal.com" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="adm-pw">Palavra-passe provisória</label>
            <input id="adm-pw" className="adm-input" type="text" required minLength={8} autoComplete="off"
              placeholder="mínimo 8 caracteres" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="adm-field">
            <label className="adm-label" htmlFor="adm-papel">Papel</label>
            <div className="adm-selectwrap">
              <select id="adm-papel" className="adm-input adm-select" value={form.papel}
                onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                <option value="operador">operador</option>
                <option value="admin">admin</option>
              </select>
              <span className="filter-caret">▾</span>
            </div>
          </div>
          <button type="submit" className="gold-btn adm-submit" disabled={busy}>
            {busy ? "A criar…" : "Criar conta"}
          </button>
        </form>

        <p className="adm-hint">
          Entrega a palavra-passe à pessoa por um canal seguro. Para a trocar mais tarde, usa <b>Nova password</b> na
          linha da conta, ou <b>Link de recuperação</b>: um link de 1 hora em que a própria pessoa define a sua.
          O <b>admin</b> gere utilizadores; o <b>operador</b> usa a plataforma sem acesso a este ecrã.
        </p>
      </section>

      {msg && <div className="adm-msg ok">{msg}</div>}
      {erro && <div className="adm-msg err">{erro}</div>}

      <div className="adm-count">{users.length} {users.length === 1 ? "conta" : "contas"}</div>

      <div className="rl-tablewrap">
        <table className="rl-table adm-table">
          <thead>
            <tr>
              <th>Email</th><th>Papel</th><th>Estado</th>
              <th>Último login</th><th>Criado</th><th style={{ textAlign: "right" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
              <tr className={u.ativo ? undefined : "off"}>
                <td>
                  <span className="adm-mail">{u.email}</span>
                  {u.id === eu && <span className="adm-you">tu</span>}
                </td>
                <td><span className={`adm-role ${u.papel}`}>{u.papel}</span></td>
                <td>
                  <span className={`adm-state ${u.ativo ? "" : "off"}`}>
                    <i />{u.ativo ? "ativo" : "desativado"}
                  </span>
                </td>
                <td>{fmtData(u.ultimo_login)}</td>
                <td>{fmtData(u.criado_em)}</td>
                <td>
                  <div className="adm-acts">
                    {u.id !== eu && (
                      <>
                        <button className="ghost-btn adm-btn" disabled={busy}
                          onClick={() => patch({ user_id: u.id, acao: "papel", papel: u.papel === "admin" ? "operador" : "admin" })}>
                          {u.papel === "admin" ? "→ operador" : "→ admin"}
                        </button>
                        <button className="ghost-btn adm-btn" disabled={busy}
                          onClick={() => patch({ user_id: u.id, acao: u.ativo ? "desativar" : "reativar" })}>
                          {u.ativo ? "Desativar" : "Reativar"}
                        </button>
                      </>
                    )}
                    <button className="ghost-btn adm-btn" disabled={busy} onClick={() => abrirPassword(u)}>Nova password</button>
                    <button className="ghost-btn adm-btn" disabled={busy} onClick={() => gerarLink(u)}>Link de recuperação</button>
                  </div>
                </td>
              </tr>
              {painel?.id === u.id && (
                <tr className="adm-inline">
                  <td colSpan={6}>
                    {painel.tipo === "password" ? (
                      <div className="adm-inline-box">
                        <input className="adm-input" type="text" autoComplete="off" spellCheck={false} value={painel.pw}
                          onChange={(e) => setPainel({ ...painel, pw: e.target.value })} aria-label="Nova palavra-passe" />
                        <button className="ghost-btn adm-btn" type="button" onClick={() => setPainel({ ...painel, pw: gerarPw() })}>Gerar outra</button>
                        <button className="gold-btn adm-btn" type="button" disabled={busy} onClick={guardarPassword}>{busy ? "A guardar…" : "Guardar"}</button>
                        <button className="ghost-btn adm-btn" type="button" onClick={() => setPainel(null)}>Cancelar</button>
                        <div className="adm-inline-note">Nova palavra-passe de <b>{painel.email}</b>. Mínimo 8 caracteres. Copia-a antes de guardar — depois não volta a aparecer.</div>
                      </div>
                    ) : (
                      <div className="adm-inline-box">
                        <input className="adm-input mono" type="text" readOnly value={painel.link} onFocus={(e) => e.target.select()} aria-label="Link de recuperação" />
                        <button className="gold-btn adm-btn" type="button" onClick={() => copiar(painel.link)}>{copiado ? "Copiado ✓" : "Copiar"}</button>
                        <button className="ghost-btn adm-btn" type="button" onClick={() => setPainel(null)}>Fechar</button>
                        <div className="adm-inline-note">
                          Link para <b>{painel.email}</b> definir a própria palavra-passe. Vale <b>1 hora</b> e uma só vez. Quem o tiver
                          entra na conta: envia-o por um canal seguro e só a essa pessoa. Não passa por e-mail — funciona mesmo sem SMTP.
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
