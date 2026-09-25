// Curadoria do membro no squad (feedback rodada 2, F2.2 — set/2026; valores da proposta da
// D7, ainda sem resposta do cliente: Sugerida → Em estudo → Aprovada / Descartada).
// Coluna list_creators.curadoria — NÃO é o `status` do pipeline (aguardando/processando/
// concluida/erro). Módulo sem dependências: é importado pelo navegador (SquadDetail, CSV)
// e pelo servidor (rota /api/lists, lib/squad-data.js).
export const CURADORIAS = ["sugerida", "em_estudo", "aprovada", "descartada"];
export const CURADORIA_LABEL = { sugerida: "Sugerida", em_estudo: "Em estudo", aprovada: "Aprovada", descartada: "Descartada" };
export const NOTAS_MAX = 2000;
