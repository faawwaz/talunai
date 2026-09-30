import type { Role } from "../../packages/client/types";

export const workspaceAreas = [
  "borrower",
  "buyer",
  "lender",
  "verifier",
  "admin",
  "agent",
] as const;
export type WorkspaceArea = (typeof workspaceAreas)[number];
export const workspaceRoles: Record<WorkspaceArea, readonly Role[]> = {
  borrower: ["BORROWER"],
  buyer: ["BUYER"],
  lender: ["LENDER"],
  verifier: ["VERIFIER"],
  admin: ["ADMIN"],
  agent: ["ADMIN", "VERIFIER"],
};
export const workspaceLabels: Record<WorkspaceArea, string> = {
  borrower: "Pemohon",
  buyer: "Pembeli",
  lender: "Pendana",
  verifier: "Verifier",
  admin: "Pengelola",
  agent: "Operasi agent",
};
type MembershipLike = { role: string; organizationStatus?: string };
export function canEnterWorkspace(
  area: WorkspaceArea,
  memberships: readonly MembershipLike[],
) {
  return memberships.some(
    (membership) =>
      (!membership.organizationStatus ||
        membership.organizationStatus === "APPROVED") &&
      workspaceRoles[area].some((role) => role === membership.role),
  );
}
export function defaultWorkspace(
  memberships: readonly MembershipLike[],
): WorkspaceArea | null {
  return (
    (["admin", "verifier", "borrower", "buyer", "lender"] as const).find(
      (area) => canEnterWorkspace(area, memberships),
    ) ?? null
  );
}
export function workspaceFromPath(path: string): WorkspaceArea | null {
  const prefix = path.split("/")[1];
  return workspaceAreas.find((area) => area === prefix) ?? null;
}
export function workspaceHref(area: WorkspaceArea, suffix = "") {
  return `/${area}${suffix ? `/${suffix.replace(/^\/+/, "")}` : ""}`;
}
export function safeWorkspaceReturn(
  value: string | undefined,
  area: WorkspaceArea,
) {
  if (!value || !value.startsWith(`/${area}`) || /[\\?#]|\.\.|%/u.test(value))
    return `/${area}`;
  return value === `/${area}` || value.startsWith(`/${area}/`)
    ? value
    : `/${area}`;
}
