"use client";
import LogoutButton from "@/components/LogoutButton";

// O shell já validou a sessão no servidor; não repetir getUser no navegador.
export default function UserBadge({ email = "" }) {
  return (
    <div className="user-row">
      <div className="user-av">{(email[0] || "•").toUpperCase()}</div>
      <div className="user-mail" title={email}>{email || "—"}</div>
      <LogoutButton />
    </div>
  );
}
