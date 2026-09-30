import { legacyWorkspaceRedirect } from "@/lib/server-workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await legacyWorkspaceRedirect(`claims/${encodeURIComponent(id)}/terms`);
}
