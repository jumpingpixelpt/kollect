"use client";
import { supabaseBrowser } from "@/lib/auth";

export default function LogoutButton() {
  async function sair() {
    await supabaseBrowser().auth.signOut();
    window.location.assign("/login");
  }
  return (
    <button type="button" className="chip" onClick={sair} title="Terminar sessão">
      Sair
    </button>
  );
}
