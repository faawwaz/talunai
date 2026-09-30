import { parseArgs } from "node:util";
import { getSql, closeDb } from "../packages/db";
import { chainConfig, publicClient } from "../packages/chain/config";
import {
  createSyntheticOrganization,
  reviewAccessRequest,
} from "../packages/api/onboarding";
import { ApiError } from "../packages/api/core";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: true,
  options: {
    operator: { type: "string" },
    request: { type: "string" },
    version: { type: "string" },
    organization: { type: "string" },
    reason: { type: "string" },
    identity: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    alias: { type: "string", multiple: true },
  },
});
try {
  const command = positionals[0],
    c = chainConfig();
  if (
    positionals.length !== 1 ||
    ![
      "list",
      "organizations",
      "approve",
      "reject",
      "create-organization",
    ].includes(command)
  )
    throw new Error(
      "Use list | organizations | create-organization | approve | reject. See docs/ONBOARDING.md.",
    );
  if (!(
    (process.env.APP_ENV === "local" && c.chainId === 31337) ||
    (process.env.APP_ENV === "testnet" && c.chainId === 97)
  ))
    throw new Error("SYNTHETIC_ENVIRONMENT_REQUIRED");
  if ((await publicClient().getChainId()) !== c.chainId)
    throw new Error("RPC_CHAIN_MISMATCH");
  const sql = getSql(),
    operatorUserId = values.operator;
  if (!operatorUserId) throw new Error("OPERATOR_USER_ID_REQUIRED");
  const admins =
    await sql`SELECT m.id FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=${operatorUserId} AND m.approved=true AND m.role='ADMIN' AND o.status='APPROVED'`;
  if (!admins.length) throw new Error("OPERATOR_ADMIN_REQUIRED");
  let result: unknown;
  if (command === "list")
    result =
      await sql`SELECT id,user_id,wallet,organization_name,requested_role,note,status,version,organization_id,review_reason,created_at,reviewed_at FROM access_requests ORDER BY created_at DESC,id DESC LIMIT 100`;
  else if (command === "organizations")
    result =
      await sql`SELECT o.id,o.name,o.kind,o.status,o.synthetic,(SELECT count(*)::integer FROM memberships m WHERE m.organization_id=o.id AND approved=true) AS assigned_authorities FROM organizations o WHERE o.synthetic=true ORDER BY o.name LIMIT 100`;
  else if (command === "create-organization")
    result = await createSyntheticOrganization({
      operatorUserId,
      identityKey: values.identity!,
      name: values.name!,
      kind: values.role as "BORROWER" | "BUYER" | "LENDER",
      reason: values.reason!,
      aliases: values.alias ?? [],
    });
  else
    result = await reviewAccessRequest({
      operatorUserId,
      requestId: values.request!,
      expectedVersion: Number(values.version),
      decision: command === "approve" ? "APPROVE" : "REJECT",
      organizationId: values.organization,
      reason: values.reason!,
    });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : "ACCESS_OPERATOR_FAILED",
  );
  process.exitCode = 1;
} finally {
  await closeDb();
}
