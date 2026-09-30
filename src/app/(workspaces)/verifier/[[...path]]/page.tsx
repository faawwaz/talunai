import { WorkspaceRoute } from "@/features/workspace/route";

export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return <WorkspaceRoute area="verifier" path={path} />;
}
