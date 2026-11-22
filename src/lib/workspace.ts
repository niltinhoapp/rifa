import { supabaseServer } from "@/lib/supabase/server";

export async function getActiveWorkspace() {
  const sb = await supabaseServer();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;

  const user = auth.user;
  if (!user) return { user: null, workspace: null, role: null };

  const { data: memberships, error: memErr } = await sb
    .from("workspace_members")
    .select("role, workspace:workspaces(id,name,slug)")
    .eq("user_id", user.id)
    .limit(1);

  if (memErr) throw memErr;

  const m = memberships?.[0] as any;

  return {
    user,
    workspace: m?.workspace ?? null,
    role: m?.role ?? null,
  };
}