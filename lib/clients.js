// Config de clientes do radar (fonte única).
// Pra ativar uma marca nova: 1) insira as marcas em `brands` com um `client` novo
// (ex.: 'pg'); 2) rode /api/pipeline/brand-fit?handle=... e /api/hire-plan?handle=...&client=<id>
// pra todas as creators; 3) adicione { id, label } aqui.
// O dropdown, o filtro de brand-fit e o "O que contratar" se ajustam sozinhos.
export const CLIENTS = [
  { id: "loreal", label: "L'Oréal" },
  // { id: "pg", label: "P&G" },
];
export const DEFAULT_CLIENT = "loreal";
export const clientLabel = (id) => CLIENTS.find((c) => c.id === id)?.label || "L'Oréal";
export const isClient = (id) => CLIENTS.some((c) => c.id === id);
