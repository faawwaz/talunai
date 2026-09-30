import { legacyWorkspaceRedirect } from "@/lib/server-workspace";
export default async function Page() {
  await legacyWorkspaceRedirect("payments");
}
