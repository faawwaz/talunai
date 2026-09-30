import { describe, expect, it } from "vitest";
import {
  canEnterWorkspace,
  defaultWorkspace,
  safeWorkspaceReturn,
  workspaceAreas,
  workspaceFromPath,
} from "../src/lib/workspace-paths";

describe("role workspace navigation policy", () => {
  it("never gives participant accounts operator or unrelated role navigation", () => {
    for (const role of ["BORROWER", "BUYER", "LENDER"]) {
      const memberships = [{ role, organizationStatus: "APPROVED" }];
      expect(
        workspaceAreas.filter((area) => canEnterWorkspace(area, memberships)),
      ).toEqual([role.toLowerCase()]);
    }
  });
  it("keeps agent operations with human operators and excludes service principals", () => {
    expect(canEnterWorkspace("agent", [{ role: "ADMIN" }])).toBe(true);
    expect(canEnterWorkspace("agent", [{ role: "VERIFIER" }])).toBe(true);
    expect(canEnterWorkspace("agent", [{ role: "AGENT" }])).toBe(false);
    expect(defaultWorkspace([{ role: "AGENT" }])).toBeNull();
    expect(
      defaultWorkspace([{ role: "ADMIN", organizationStatus: "REVOKED" }]),
    ).toBeNull();
    expect(defaultWorkspace([])).toBeNull();
  });
  it("restricts post-login destinations to the exact requested workspace", () => {
    for (const bad of [
      "https://outside.test",
      "//outside.test",
      "/admin",
      "/borrowerevil",
      "/borrower/../admin",
      "/borrower/%2e%2e/admin",
      "/borrower\\admin",
      "/borrower?next=//outside.test",
      "/borrower#admin",
    ]) {
      expect(safeWorkspaceReturn(bad, "borrower")).toBe("/borrower");
    }
    expect(safeWorkspaceReturn("/borrower/claims/abc/terms", "borrower")).toBe(
      "/borrower/claims/abc/terms",
    );
    expect(workspaceFromPath("/borrowerevil")).toBeNull();
    expect(workspaceFromPath("/verifier/claims/abc")).toBe("verifier");
  });
});
