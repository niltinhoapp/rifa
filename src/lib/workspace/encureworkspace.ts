import { supabaseServer } from "@/lib/supabase/server";

export async function ensureWorkspace() {
  const sb = await supabaseServer();

  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) return { user: null, workspace: null };

  // tenta pegar 1 workspace via membership
  const { data: memberships } = await sb
    .from("workspace_members")
    .select("workspace:workspaces(id,name)")
    .eq("user_id", user.id)
    .limit(1);

  const workspace = memberships?.[0]?.workspace ?? null;
  if (workspace) return { user, workspace };

  // não tem -> cria default + vincula
  const { data: ws, error: wsErr } = await sb
    .from("workspaces")
    .insert({ name: "Meu workspace", owner_user_id: user.id })
    .select("id,name")
    .single();

  if (wsErr) throw wsErr;

  const { error: memErr } = await sb
    .from("workspace_members")
    .insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });

  if (memErr) throw memErr;

  return { user, workspace: ws };
}