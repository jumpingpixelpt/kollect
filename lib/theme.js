// Tema claro principal; preserva a escolha explícita do usuário pelo tema escuro.
export const THEME_KEY = "kollect-theme";
export function temaAtual() {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
export function aplicarTema(tema) {
  if (tema === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  return tema;
}
export const THEME_BOOT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.dataset.theme="dark";else delete document.documentElement.dataset.theme}catch(e){delete document.documentElement.dataset.theme}`;
