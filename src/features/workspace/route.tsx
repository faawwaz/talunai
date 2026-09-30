import "server-only";
import { notFound } from "next/navigation";
import {
  requireWorkspace,
  requireWorkspaceClaim,
} from "@/lib/server-workspace";
import type { WorkspaceArea } from "@/lib/workspace-paths";
import { ClaimsList } from "@/features/claims/list";
import { CreateClaimPage } from "@/features/claims/create";
import { ClaimDetail } from "@/features/claims/detail";
import { TasksPage, ActivityPage, PaymentsPage, SettingsPage } from "./pages";
import { RoleHome } from "./role-home";
import ExplorePage from "@/app/app/explore/page";
import { AccessAdminPage } from "@/features/onboarding/admin";
import {
  AgentOverviewPage,
  AgentRunsPage,
  AgentRunDetailPage,
  AgentTransactionsPage,
  AdminOrganizationsPage,
  AdminAuditPage,
} from "@/features/ops/pages";

/** Every leaf navigation checks the session; layouts alone can be reused by Next. */
export async function WorkspaceRoute({
  area,
  path = [],
}: {
  area: WorkspaceArea;
  path?: string[];
}) {
  await requireWorkspace(
    area,
    `/${area}${path.length ? `/${path.join("/")}` : ""}`,
  );
  if (!path.length)
    return area === "agent" ? <AgentOverviewPage /> : <RoleHome area={area} />;
  if (path.length === 1 && path[0] === "explore") return <ExplorePage />;
  if (path.length === 1 && path[0] === "settings") return <SettingsPage />;
  if (area === "agent") {
    if (path.length === 1 && path[0] === "runs") return <AgentRunsPage />;
    if (
      path.length === 2 &&
      path[0] === "runs" &&
      /^[a-zA-Z0-9_-]{1,120}$/.test(path[1])
    )
      return <AgentRunDetailPage id={path[1]} />;
    if (path.length === 1 && path[0] === "transactions")
      return <AgentTransactionsPage />;
    notFound();
  }
  if (area === "admin" && path.length === 1) {
    if (path[0] === "access") return <AccessAdminPage />;
    if (path[0] === "organizations") return <AdminOrganizationsPage />;
    if (path[0] === "audit") return <AdminAuditPage />;
  }
  if (path.length === 1) {
    if (path[0] === "claims") return <ClaimsList />;
    if (path[0] === "tasks") return <TasksPage />;
    if (path[0] === "activity") return <ActivityPage />;
    if (path[0] === "payments") return <PaymentsPage />;
  }
  if (path[0] === "claims") {
    if (path.length === 2 && path[1] === "new") {
      if (area !== "borrower") notFound();
      return <CreateClaimPage />;
    }
    if (
      path.length >= 2 &&
      path.length <= 3 &&
      /^[a-zA-Z0-9_-]{1,120}$/.test(path[1])
    ) {
      const tab = path[2] ?? "summary";
      if (
        !["summary", "evidence", "terms", "payments", "activity"].includes(tab)
      )
        notFound();
      await requireWorkspaceClaim(area, path[1]);
      return (
        <ClaimDetail
          id={path[1]}
          tab={
            tab as "summary" | "evidence" | "terms" | "payments" | "activity"
          }
        />
      );
    }
  }
  notFound();
}
