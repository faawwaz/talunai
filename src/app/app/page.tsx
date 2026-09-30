import { redirect } from "next/navigation";
import { serverActor } from "@/lib/server-workspace";
import { canEnterWorkspace, workspaceAreas } from "@/lib/workspace-paths";
import { WorkspaceEntry } from "@/features/workspace/entry";

export default async function Page() {
  const actor = await serverActor();
  const areas = workspaceAreas.filter(
    (area) =>
      area !== "agent" && canEnterWorkspace(area, actor?.memberships ?? []),
  );
  if (areas.length === 1) redirect(`/${areas[0]}`);
  return <WorkspaceEntry />;
}
