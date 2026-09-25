import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sessionUser } from "@/lib/auth-server";
import { autorizado, NAO_AUTORIZADO } from "@/lib/api-auth";
import { fetchSquads, fetchSquadSnapshot, iniciaisDe } from "@/lib/squad-data";
import { addSquadItems, squadItems, validSquadId } from "@/lib/squad-input";
import { CURADORIAS, NOTAS_MAX } from "@/lib/squad-curadoria";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Squads continuam compartilhados pela equipe. user_id identifica exclusivamente
// quem os criou para os alertas; não altera a regra existente de acesso e gestão.
export async function GET(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
    const db = supabaseAdmin();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ lists: await fetchSquads(db) });
    if (!validSquadId(id)) return NextResponse.json({ error: "Squad inválido." });
    const snapshot = await fetchSquadSnapshot(db, id);
    return NextResponse.json(snapshot || { error: "Squad não encontrado." });
  } catch { return NextResponse.json({ error: "Não foi possível carregar os squads." }); }
}

// Falha de leitura depois da gravação não pode ser apresentada como falha da ação:
// o navegador precisa reconciliar os dados, sem desfazer visualmente algo já salvo.
async function updated(db, id, result = {}) {
  try { return NextResponse.json({ ok: true, ...result, ...await fetchSquadSnapshot(db, id) }); }
  catch { return NextResponse.json({ ok: true, ...result, refreshRequired: true, warning: "Alteração salva. Atualize o squad para conferir os KPIs." }); }
}

export async function POST(req) {
  if (!(await autorizado(req))) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  try {
    const db = supabaseAdmin();
    const body = await req.json();
    if (body.action && !["update_item", "update_curadoria", "remove_item", "delete_list", "add_items"].includes(body.action)) {
      return NextResponse.json({ error: "Ação inválida." });
    }
    if (body.action && !validSquadId(body.list_id)) return NextResponse.json({ error: "Squad inválido." });

    if (body.action === "update_item") {
      const { list_id, prospect_id, creator_id, status } = body;
      if (!["aguardando", "processando", "concluida", "erro"].includes(status) ||
          (prospect_id != null && (typeof prospect_id !== "string" || !prospect_id.trim() || prospect_id.length > 200)) ||
          (!prospect_id && !validSquadId(creator_id)) || (creator_id && !validSquadId(creator_id))) {
        return NextResponse.json({ error: "Dados do membro inválidos." });
      }
      // A promoção usa o mesmo lock de inclusão/remoção: um creator incluído
      // enquanto o prospect era analisado deve continuar sendo um único membro.
      const { data: changed, error } = await db.rpc("update_squad_item", {
        p_list_id: list_id, p_prospect_id: prospect_id ?? null,
        p_creator_id: creator_id ?? null, p_status: status,
      });
      if (error || !Number.isInteger(changed) || changed < 0) throw new Error("Não foi possível atualizar o membro.");
      return updated(db, list_id);
    }

    // Status de curadoria e notas do membro (feedback rodada 2, F2.2). Mesma regra de edição
    // das outras ações do squad: qualquer sessão da equipa (squads são partilhados). Grava
    // direto na linha (não passa pelas RPCs do pipeline, que só mexem em `status`) e devolve
    // só o membro alterado — a nota grava ao sair do campo e não deve recarregar a squad toda.
    if (body.action === "update_curadoria") {
      if (!validSquadId(body.item_id)) return NextResponse.json({ error: "Membro inválido." });
      const patch = {};
      if (body.curadoria !== undefined) {
        if (!CURADORIAS.includes(body.curadoria)) return NextResponse.json({ error: "Status inválido." });
        patch.curadoria = body.curadoria;
      }
      if (body.notas !== undefined) {
        if (body.notas !== null && typeof body.notas !== "string") return NextResponse.json({ error: "Nota inválida." });
        const notas = String(body.notas ?? "").trim();
        if (notas.length > NOTAS_MAX) return NextResponse.json({ error: `A nota aceita até ${NOTAS_MAX} caracteres.` });
        // o autor vem sempre da sessão, nunca do navegador; pelo Bearer (sem sessão) fica null
        const user = await sessionUser().catch(() => null);
        Object.assign(patch, { notas: notas || null, notas_por: notas ? user?.id ?? null : null, notas_em: notas ? new Date().toISOString() : null });
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: "Nada para gravar." });
      const { data, error } = await db.from("list_creators").update(patch)
        .eq("list_id", body.list_id).eq("id", body.item_id)
        .select("id, curadoria, notas, notas_por, notas_em");
      if (error) throw new Error("Não foi possível gravar a alteração do membro.");
      if (!data?.length) return NextResponse.json({ error: "Este membro já não está na squad. Atualize a página." });
      const { notas_por, ...item } = data[0];
      let notas_autor = null;
      if (notas_por) {
        try { notas_autor = iniciaisDe((await db.auth.admin.getUserById(notas_por)).data?.user); } catch { /* sem autor */ }
      }
      return NextResponse.json({ ok: true, item: { ...item, notas_autor } });
    }

    // Só desfaz a associação: creator e prospect permanecem na base e nas outras squads.
    if (body.action === "remove_item") {
      if (!validSquadId(body.item_id)) return NextResponse.json({ error: "Membro inválido." });
      const { error } = await db.rpc("remove_squad_item", { p_list_id: body.list_id, p_item_id: body.item_id });
      if (error) throw new Error("Não foi possível remover o membro.");
      // Idempotente: uma repetição após timeout mantém o resultado confirmado.
      return updated(db, body.list_id);
    }

    if (body.action === "delete_list") {
      // O esquema verificado tem ON DELETE CASCADE; uma operação evita apagar os
      // membros se a exclusão da própria lista falhar.
      const { data, error } = await db.from("lists").delete().eq("id", body.list_id).select("id");
      if (error) throw new Error("Não foi possível apagar o squad.");
      if (!data?.length) return NextResponse.json({ error: "Squad não encontrado." });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "add_items") {
      const added = await addSquadItems(db, body.list_id, body.items ?? []);
      return updated(db, body.list_id, { added });
    }

    const { name, client = "loreal", campaign_id = null } = body;
    if (typeof name !== "string" || !name.trim() || name.length > 200) return NextResponse.json({ error: "Informe um nome com até 200 caracteres." });
    if (campaign_id && !validSquadId(campaign_id)) return NextResponse.json({ error: "Campanha inválida." });
    const items = squadItems(body.items ?? []);
    // A origem do dono é sempre a sessão, nunca um user_id enviado pelo navegador.
    const user = await sessionUser();
    const { data: list, error } = await db.from("lists").insert({ name: name.trim(), client, campaign_id, user_id: user?.id ?? null }).select("id").single();
    if (error) throw new Error("Não foi possível criar o squad.");
    if (items.length) {
      try { await addSquadItems(db, list.id, items); }
      catch {
        return NextResponse.json({ id: list.id, error: "Squad criado, mas os membros não foram incluídos. Abra o squad para tentar novamente." });
      }
    }
    return NextResponse.json({ id: list.id });
  } catch (e) { return NextResponse.json({ error: e instanceof SyntaxError ? "Dados inválidos." : e.message || "Não foi possível salvar a alteração." }); }
}
