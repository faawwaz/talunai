import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { WorkspaceLogin } from "@/features/workspace/entry";
import { workspaceAreas, safeWorkspaceReturn } from "@/lib/workspace-paths";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; next?: string }>;
}) {
  const query = await searchParams;
  const area = workspaceAreas.find((item) => item === query.workspace);
  if (!area) redirect("/app");
  return (
    <WorkspaceShell>
      <WorkspaceLogin
        area={area}
        destination={safeWorkspaceReturn(query.next, area)}
      />
    </WorkspaceShell>
  );
}
