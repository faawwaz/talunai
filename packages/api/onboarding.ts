import { z } from "zod";
import {
  erc20Abi,
  keccak256,
  parseAbi,
  toHex,
  zeroHash,
  type Address,
} from "viem";
import { getSql, type DbTransaction } from "../db";
import { chainConfig, publicClient } from "../chain/config";
import { pagination } from "./read-models";
import {
  ApiError,
  audit,
  canonical,
  hash,
  id,
  json,
  mutate,
  readBody,
  requireRole,
  type Actor,
} from "./core";

export const AccessRequestInput = z
  .object({
    organizationName: z.string().trim().min(3).max(160),
    requestedRole: z.enum(["BORROWER", "BUYER", "LENDER"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
type RequestRow = {
  id: string;
  user_id: string;
  wallet: string;
  organization_name: string;
  requested_role: "BORROWER" | "BUYER" | "LENDER";
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  version: number;
  organization_id: string | null;
  review_reason: string | null;
  reviewed_at: Date | null;
  created_at: Date;
};
export function accessRequestModel(r: RequestRow) {
  return {
    id: r.id,
    organizationName: r.organization_name,
    requestedRole: r.requested_role,
    note: r.note,
    status: r.status,
    version: r.version,
    organizationId: r.organization_id,
    reviewReason: r.review_reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    isSynthetic: true as const,
  };
}

const rolesAbi = parseAbi([
  "function hasRole(bytes32 role,address account) view returns (bool)",
]);
export async function lenderReadiness(actor: Actor) {
  requireRole(actor, ["LENDER"]);
  const c = chainConfig();
  const client = publicClient();
  let blockNumber: bigint;
  let allowlisted: boolean;
  let balance: bigint;
  let allowance: bigint;
  let gasBalance: bigint;
  try {
    if ((await client.getChainId()) !== c.chainId)
      throw new Error("RPC_CHAIN_MISMATCH");
    const head = await client.getBlockNumber({ cacheTime: 0 });
    blockNumber = head - BigInt(c.confirmations) + 1n;
    if (blockNumber < 0n) throw new Error("CHAIN_NOT_CONFIRMED");
    [allowlisted, balance, allowance, gasBalance] = await Promise.all([
      client.readContract({
        address: c.vault,
        abi: rolesAbi,
        functionName: "hasRole",
        args: [keccak256(toHex("LENDER_ROLE")), actor.wallet],
        blockNumber,
      }),
      client.readContract({
        address: c.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [actor.wallet],
        blockNumber,
      }),
      client.readContract({
        address: c.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [actor.wallet, c.vault],
        blockNumber,
      }),
      client.getBalance({ address: actor.wallet, blockNumber }),
    ]);
  } catch {
    throw new ApiError(503, "CHAIN_UNAVAILABLE");
  }
  const nextAction = !allowlisted
    ? "REQUEST_LENDER_ALLOWLIST"
    : balance === 0n
      ? "GET_TEST_TOKEN"
      : gasBalance === 0n
        ? "GET_TESTNET_GAS"
        : allowance === 0n
          ? "APPROVE_TOKEN"
          : "READY";
  return json({
    wallet: actor.wallet,
    chainId: c.chainId,
    blockNumber: blockNumber.toString(),
    stateConfidence: "CONFIRMED_CHAIN_READ",
    appMembershipApproved: true,
    chainAllowlisted: allowlisted,
    tokenBalance: balance.toString(),
    vaultAllowance: allowance.toString(),
    gasBalanceWei: gasBalance.toString(),
    nextAction,
    isSynthetic: true,
  });
}
/** Fresh public-chain role reads, never private keys. Uncertain RPC cannot grant participant access. */
export async function restrictedParticipantWallet(
  actor: Pick<Actor, "userId" | "wallet">,
  sql = getSql() as unknown as DbTransaction,
) {
  const privileged =
    await sql`SELECT id FROM memberships WHERE user_id=${actor.userId} AND approved=true AND role IN ('ADMIN','VERIFIER','AGENT') LIMIT 1`;
  if (privileged.length) return true;
  const c = chainConfig(),
    client = publicClient();
  const checks: Array<[Address, `0x${string}`]> = [
    [c.executor, keccak256(toHex("AGENT_ROLE"))],
    [c.registry, keccak256(toHex("VERIFIER_ROLE"))],
    [c.token, keccak256(toHex("DEMO_MINTER_ROLE"))],
    ...[c.registry, c.vault, c.executor, c.token].map(
      (address) => [address, zeroHash] as [Address, `0x${string}`],
    ),
  ];
  try {
    if ((await client.getChainId()) !== c.chainId)
      throw new Error("RPC_CHAIN_MISMATCH");
    const result = await Promise.all(
      checks.map(([address, role]) =>
        client.readContract({
          address,
          abi: rolesAbi,
          functionName: "hasRole",
          args: [role, actor.wallet],
        }),
      ),
    );
    return result.some(Boolean);
  } catch {
    throw new ApiError(503, "ACCESS_ROLE_CHECK_UNAVAILABLE");
  }
}

export async function getAccessRequest(actor: Actor) {
  const [rows, restrictedWallet] = await Promise.all([
    getSql()`SELECT * FROM access_requests WHERE user_id=${actor.userId} ORDER BY created_at DESC,id DESC LIMIT 1`,
    restrictedParticipantWallet(actor),
  ]);
  return json({
    request: rows.length ? accessRequestModel(rows[0] as RequestRow) : null,
    restrictedWallet,
  });
}

export async function createAccessRequest(
  req: Request,
  actor: Actor,
  correlationId: string,
) {
  const body = AccessRequestInput.parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => {
    await tx`SELECT id FROM users WHERE id=${actor.userId} FOR UPDATE`;
    if (await restrictedParticipantWallet(actor, tx))
      throw new ApiError(403, "PARTICIPANT_WALLET_REQUIRED");
    const memberships =
      await tx`SELECT id FROM memberships WHERE user_id=${actor.userId} AND approved=true LIMIT 1`;
    if (memberships.length) throw new ApiError(409, "ACCESS_ALREADY_GRANTED");
    const pending =
      await tx`SELECT id FROM access_requests WHERE user_id=${actor.userId} AND status='PENDING' LIMIT 1`;
    if (pending.length) throw new ApiError(409, "ACCESS_REQUEST_PENDING");
    const [created] =
      await tx`INSERT INTO access_requests(id,user_id,wallet,organization_name,requested_role,note) VALUES(${id()},${actor.userId},${actor.wallet.toLowerCase()},${body.organizationName},${body.requestedRole},${body.note || null}) RETURNING *`;
    await audit(
      tx,
      actor,
      "ACCESS_REQUEST_CREATED",
      created.id,
      correlationId,
      { requestedRole: body.requestedRole, isSynthetic: true },
      undefined,
      hash(canonical(created)),
    );
    return {
      status: 201,
      body: {
        request: accessRequestModel(created as RequestRow),
        restrictedWallet: false,
      },
    };
  });
}

async function operator(
  tx: DbTransaction,
  userId: string,
  authenticatedActor?: Actor,
): Promise<Actor> {
  const [row] =
    await tx`SELECT m.organization_id,w.address FROM memberships m JOIN organizations o ON o.id=m.organization_id JOIN wallets w ON w.user_id=m.user_id WHERE m.user_id=${userId} AND m.approved=true AND m.role='ADMIN' AND o.status='APPROVED' AND (${authenticatedActor?.wallet ?? null}::text IS NULL OR w.address=${authenticatedActor?.wallet.toLowerCase() ?? null}) ORDER BY w.address LIMIT 1`;
  if (!row) throw new ApiError(403, "OPERATOR_ADMIN_REQUIRED");
  return {
    userId,
    wallet: authenticatedActor?.wallet ?? row.address,
    sessionHash: authenticatedActor?.sessionHash ?? "LOCAL_OPERATOR_CLI",
    memberships: [{ organizationId: row.organization_id, role: "ADMIN" }],
  };
}
function testEnvironmentOnly() {
  const c = chainConfig();
  if (!(
    (c.chainId === 97 && process.env.APP_ENV === "testnet") ||
    (c.chainId === 31337 && process.env.APP_ENV === "local")
  ))
    throw new ApiError(403, "SYNTHETIC_ENVIRONMENT_REQUIRED");
}
export const AccessReviewInput = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REJECT"]),
    organizationId: z.string().min(1).optional(),
    reason: z.string().trim().min(10).max(1000),
    operatorUserId: z.string().min(1),
  })
  .strict();

/** Shared operator action: local CLI or authenticated ADMIN API; never participant self-service. */
type OperatorContext = { actor: Actor; tx: DbTransaction };
export async function reviewAccessRequest(
  input: z.input<typeof AccessReviewInput>,
  context?: OperatorContext,
) {
  testEnvironmentOnly();
  const body = AccessReviewInput.parse(input);
  const run = async (tx: DbTransaction) => {
    const actor = await operator(
      tx,
      context?.actor.userId ?? body.operatorUserId,
      context?.actor,
    );
    const [r] =
      (await tx`SELECT * FROM access_requests WHERE id=${body.requestId} FOR UPDATE`) as RequestRow[];
    if (!r) throw new ApiError(404, "ACCESS_REQUEST_NOT_FOUND");
    if (r.status !== "PENDING" || r.version !== body.expectedVersion)
      throw new ApiError(409, "ACCESS_REQUEST_STALE");
    await tx`SELECT id FROM users WHERE id=${r.user_id} FOR UPDATE`;
    if (body.decision === "APPROVE") {
      if (!body.organizationId)
        throw new ApiError(422, "CANONICAL_ORGANIZATION_REQUIRED");
      if (
        await restrictedParticipantWallet(
          { userId: r.user_id, wallet: r.wallet as Address },
          tx,
        )
      )
        throw new ApiError(403, "PARTICIPANT_WALLET_REQUIRED");
      const userWallets =
        await tx`SELECT address FROM wallets WHERE user_id=${r.user_id}`;
      if (userWallets.length !== 1 || userWallets[0].address !== r.wallet)
        throw new ApiError(409, "WALLET_AUTHORITY_REVIEW_REQUIRED");
      const memberships =
        await tx`SELECT id FROM memberships WHERE user_id=${r.user_id} AND approved=true`;
      if (memberships.length) throw new ApiError(409, "ACCESS_ALREADY_GRANTED");
      const [org] =
        await tx`SELECT * FROM organizations WHERE id=${body.organizationId} FOR UPDATE`;
      if (
        !org ||
        org.status !== "APPROVED" ||
        !org.synthetic ||
        org.kind !== r.requested_role
      )
        throw new ApiError(422, "APPROVED_SYNTHETIC_ORGANIZATION_REQUIRED");
      // P0 uses exactly one immutable participant authority per canonical organization.
      // Never silently replace a seeded wallet or inherit another actor's confidential claims.
      const occupied =
        await tx`SELECT id FROM memberships WHERE organization_id=${org.id} AND approved=true LIMIT 1`;
      if (occupied.length)
        throw new ApiError(409, "ORGANIZATION_AUTHORITY_ALREADY_ASSIGNED");
      await tx`INSERT INTO memberships(id,user_id,organization_id,role,approved) VALUES(${id()},${r.user_id},${org.id},${r.requested_role},true)`;
      await tx`UPDATE users SET status='PROVISIONED_SYNTHETIC' WHERE id=${r.user_id}`;
    }
    const [updated] =
      await tx`UPDATE access_requests SET status=${body.decision === "APPROVE" ? "APPROVED" : "REJECTED"},version=version+1,organization_id=${body.decision === "APPROVE" ? body.organizationId! : null},review_reason=${body.reason},reviewed_by=${actor.userId},reviewed_at=now() WHERE id=${r.id} RETURNING *`;
    await audit(
      tx,
      actor,
      `ACCESS_REQUEST_${updated.status}`,
      r.id,
      id(),
      {
        reason: body.reason,
        organizationId: updated.organization_id,
        requestedRole: r.requested_role,
        mechanism: context ? "AUTHENTICATED_ADMIN_API" : "TRUSTED_LOCAL_CLI",
        operatorWallet: actor.wallet,
        isSynthetic: true,
      },
      hash(canonical(r)),
      hash(canonical(updated)),
    );
    return {
      request: accessRequestModel(updated as RequestRow),
      remainingGate:
        body.decision === "APPROVE" && r.requested_role === "LENDER"
          ? "ONCHAIN_LENDER_ALLOWLIST_REQUIRED"
          : null,
      chainTransactionSent: false,
    };
  };
  return context ? run(context.tx) : getSql().begin(run);
}

export const CreateSyntheticOrganizationInput = z
  .object({
    identityKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{2,99}$/),
    name: z.string().trim().min(3).max(160),
    kind: z.enum(["BORROWER", "BUYER", "LENDER"]),
    aliases: z.array(z.string().trim().min(3).max(160)).max(10).default([]),
    reason: z.string().trim().min(10).max(1000),
    operatorUserId: z.string().min(1),
  })
  .strict();
export const organizationAliasKey = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export async function createSyntheticOrganization(
  input: z.input<typeof CreateSyntheticOrganizationInput>,
  context?: OperatorContext,
) {
  testEnvironmentOnly();
  const body = CreateSyntheticOrganizationInput.parse(input),
    aliases = [
      ...new Set([body.name, ...body.aliases].map(organizationAliasKey)),
    ];
  if (aliases.some((v) => v.length < 3))
    throw new ApiError(422, "ORGANIZATION_NAME_REQUIRED");
  const run = async (tx: DbTransaction) => {
    const actor = await operator(
      tx,
      context?.actor.userId ?? body.operatorUserId,
      context?.actor,
    );
    await tx`SELECT pg_advisory_xact_lock(716253820)`;
    const identities =
      await tx`SELECT organization_id FROM synthetic_organization_identities WHERE identity_key=${body.identityKey}`;
    const existing =
      await tx`SELECT organization_id FROM organization_aliases WHERE alias_key IN ${tx(aliases)}`;
    // Include records provisioned by old seed tools after the alias migration.
    const legacy =
      await tx`SELECT id FROM organizations WHERE regexp_replace(lower(normalize(name,NFKC)), '[^[:alnum:]]', '', 'g') IN ${tx(aliases)}`;
    if (identities.length || existing.length || legacy.length)
      throw new ApiError(409, "CANONICAL_ORGANIZATION_ALREADY_EXISTS");
    const organizationId = `org-${id()}`;
    await tx`INSERT INTO organizations(id,name,kind,status,synthetic) VALUES(${organizationId},${body.name},${body.kind},'APPROVED',true)`;
    await tx`INSERT INTO synthetic_organization_identities(identity_key,organization_id) VALUES(${body.identityKey},${organizationId})`;
    for (const alias of aliases)
      await tx`INSERT INTO organization_aliases(alias_key,organization_id) VALUES(${alias},${organizationId})`;
    await audit(
      tx,
      actor,
      "SYNTHETIC_ORGANIZATION_PROVISIONED",
      organizationId,
      id(),
      {
        name: body.name,
        kind: body.kind,
        identityKey: body.identityKey,
        aliases,
        reason: body.reason,
        mechanism: context ? "AUTHENTICATED_ADMIN_API" : "TRUSTED_LOCAL_CLI",
        operatorWallet: actor.wallet,
        isSynthetic: true,
        kybStatus: "NOT_INTEGRATED",
      },
    );
    return {
      organizationId,
      name: body.name,
      kind: body.kind,
      isSynthetic: true,
      kybStatus: "NOT_INTEGRATED",
      chainTransactionSent: false,
    };
  };
  return context ? run(context.tx) : getSql().begin(run);
}

export async function listAccessRequests(req: Request, actor: Actor) {
  requireRole(actor, ["ADMIN"]);
  const { limit, offset } = pagination(req),
    sql = getSql();
  await operator(sql as unknown as DbTransaction, actor.userId, actor);
  const status = z
    .enum(["PENDING", "APPROVED", "REJECTED"])
    .optional()
    .parse(new URL(req.url).searchParams.get("status") ?? undefined);
  const rows =
    await sql`SELECT * FROM access_requests WHERE (${status ?? null}::text IS NULL OR status=${status ?? null}) ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM access_requests WHERE (${status ?? null}::text IS NULL OR status=${status ?? null})`;
  return json({
    items: rows.map((r) => ({
      ...accessRequestModel(r as RequestRow),
      wallet: r.wallet,
      userId: r.user_id,
    })),
    limit,
    offset,
    total: count.total,
  });
}

export async function listAccessOrganizations(req: Request, actor: Actor) {
  requireRole(actor, ["ADMIN"]);
  const { limit, offset } = pagination(req),
    sql = getSql();
  await operator(sql as unknown as DbTransaction, actor.userId, actor);
  const role = z
    .enum(["BORROWER", "BUYER", "LENDER"])
    .optional()
    .parse(new URL(req.url).searchParams.get("role") ?? undefined);
  const rows =
    await sql`SELECT o.id,o.name,o.kind,EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=o.id AND m.approved=true) AS occupied FROM organizations o WHERE o.status='APPROVED' AND o.synthetic=true AND o.kind IN ('BORROWER','BUYER','LENDER') AND (${role ?? null}::text IS NULL OR o.kind=${role ?? null}) ORDER BY o.name,o.id LIMIT ${limit} OFFSET ${offset}`;
  const [count] =
    await sql`SELECT count(*)::integer AS total FROM organizations o WHERE o.status='APPROVED' AND o.synthetic=true AND o.kind IN ('BORROWER','BUYER','LENDER') AND (${role ?? null}::text IS NULL OR o.kind=${role ?? null})`;
  return json({
    items: rows.map((r) => ({ ...r, isSynthetic: true })),
    limit,
    offset,
    total: count.total,
  });
}

const ReviewBody = AccessReviewInput.omit({
  operatorUserId: true,
  requestId: true,
});
export async function reviewAccessRequestApi(
  req: Request,
  actor: Actor,
  requestId: string,
) {
  requireRole(actor, ["ADMIN"]);
  const body = ReviewBody.parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => ({
    body: await reviewAccessRequest(
      { ...body, requestId, operatorUserId: actor.userId },
      { actor, tx },
    ),
  }));
}
const OrganizationBody = CreateSyntheticOrganizationInput.omit({
  operatorUserId: true,
  aliases: true,
});
export async function createSyntheticOrganizationApi(
  req: Request,
  actor: Actor,
) {
  requireRole(actor, ["ADMIN"]);
  const body = OrganizationBody.parse(await readBody(req));
  return mutate(req, actor, body, async (tx) => {
    const org = await createSyntheticOrganization(
      { ...body, operatorUserId: actor.userId },
      { actor, tx },
    );
    return {
      status: 201,
      body: {
        organization: {
          id: org.organizationId,
          name: org.name,
          kind: org.kind,
          isSynthetic: true,
          kybStatus: "NOT_INTEGRATED",
        },
        chainTransactionSent: false,
      },
    };
  });
}
