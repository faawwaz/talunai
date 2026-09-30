import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/server-workspace";
export default async function Page() {
  await requireWorkspace("admin", "/admin/access");
  redirect("/admin/access");
}
