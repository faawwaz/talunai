import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authenticate } from "../../packages/api/auth";
import { ApiError, authorizedClaim } from "../../packages/api/core";
import { config } from "../../packages/api/config";
import {
  canEnterWorkspace,
  defaultWorkspace,
  type WorkspaceArea,
} from "./workspace-paths";

function databaseConnectionUnavailable(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (
      candidate.code === "ECONNREFUSED" ||
      candidate.code === "ETIMEDOUT" ||
      candidate.code === "ECONNRESET"
    )
      return true;
    current = candidate.cause;
  }
  return false;
}

// React cache deduplicates within this render request, never across sessions.
export const serverActor = cache(async () => {
  const requestHeaders = new Headers(await headers());
  try {
    return await authenticate(
      new Request(`${config().APP_ORIGIN}/v1/me`, { headers: requestHeaders }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    if (databaseConnectionUnavailable(error))
      redirect("/app/service-unavailable");
    throw error;
  }
});

export async function requireWorkspace(area: WorkspaceArea, path = `/${area}`) {
  const actor = await serverActor();
  if (!actor)
    redirect(`/login?workspace=${area}&next=${encodeURIComponent(path)}`);
  if (!canEnterWorkspace(area, actor.memberships)) notFound();
  return actor;
}

export async function requireWorkspaceClaim(area: WorkspaceArea, id: string) {
  const actor = await requireWorkspace(area);
  try {
    await authorizedClaim(actor, id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status))
      notFound();
    throw error;
  }
}

export async function legacyWorkspaceRedirect(suffix = "") {
  const actor = await serverActor();
  if (!actor) redirect("/app");
  const area = defaultWorkspace(actor.memberships);
  if (!area) redirect("/app");
  redirect(`/${area}${suffix ? `/${suffix}` : ""}`);
}
