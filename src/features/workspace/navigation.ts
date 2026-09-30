"use client";

import { usePathname } from "next/navigation";
import { useSession } from "@/features/session/provider";
import {
  defaultWorkspace,
  workspaceFromPath,
  workspaceHref,
} from "@/lib/workspace-paths";
export { workspaceHref } from "@/lib/workspace-paths";
export type { WorkspaceArea } from "@/lib/workspace-paths";

export function useWorkspaceNavigation() {
  const pathname = usePathname();
  const { user } = useSession();
  const area =
    workspaceFromPath(pathname) ??
    defaultWorkspace(user?.memberships ?? []) ??
    "borrower";
  const base = `/${area}`;
  const href = (suffix = "") => workspaceHref(area, suffix);
  const claimHref = (id: string, tab?: string) => {
    const claimArea =
      area === "agent"
        ? user?.memberships.some((membership) => membership.role === "ADMIN")
          ? "admin"
          : "verifier"
        : area;
    return workspaceHref(
      claimArea,
      `claims/${encodeURIComponent(id)}${tab && tab !== "summary" ? `/${tab}` : ""}`,
    );
  };
  return { area, base, href, claimHref };
}
