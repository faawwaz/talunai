import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createPublicClient, getAddress, http, verifyMessage } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { getSql, getDb } from "../db";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  sessions as sessionTable,
  memberships as membershipTable,
  organizations as organizationTable,
  users as userTable,
} from "../db/schema";
import { config } from "./config";
import {
  ApiError,
  type Actor,
  checkOrigin,
  hash,
  id,
  json,
  rateLimit,
  readBody,
  secretHash,
} from "./core";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export function cookie(req: Request, name: string) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function sessionCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config().APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
}
export function csrfCookie(value: string, seconds: number) {
  // This token is readable by same-origin JS; the opaque authentication cookie remains HttpOnly.
  return `talunai_csrf=${value}; Path=/; SameSite=Strict; Max-Age=${seconds}${config().APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
}
export async function authenticate(req: Request): Promise<Actor> {
  const token = cookie(req, "talunai_session");
  if (!token) throw new ApiError(401, "AUTH_REQUIRED");
  const tokenHash = secretHash(token);
  const sessions = await getDb()
    .select()
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.tokenHash, tokenHash),
        gt(sessionTable.expiresAt, new Date()),
        isNull(sessionTable.revokedAt),
      ),
    );
  if (!sessions.length) throw new ApiError(401, "SESSION_INVALID");
  const stored = sessions[0],
    s = {
      user_id: stored.userId,
      wallet: stored.wallet,
      csrf_hash: stored.csrfHash,
    };
  const [user] = await getDb()
    .select({ status: userTable.status })
    .from(userTable)
    .where(eq(userTable.id, s.user_id));
  if (!user || !["PENDING", "PROVISIONED_SYNTHETIC"].includes(user.status))
    throw new ApiError(403, "ACCOUNT_INACTIVE");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    checkOrigin(req);
    const csrf = req.headers.get("x-csrf-token");
    if (!csrf || secretHash(csrf) !== s.csrf_hash)
      throw new ApiError(403, "CSRF_INVALID");
    await rateLimit(`mutation:${s.user_id}`, 100);
  }
  const rows = await getDb()
    .select({
      organizationId: membershipTable.organizationId,
      role: membershipTable.role,
    })
    .from(membershipTable)
    .innerJoin(
      organizationTable,
      eq(organizationTable.id, membershipTable.organizationId),
    )
    .where(
      and(
        eq(membershipTable.userId, s.user_id),
        eq(membershipTable.approved, true),
        eq(organizationTable.status, "APPROVED"),
      ),
    );
  return {
    userId: s.user_id,
    wallet: s.wallet as `0x${string}`,
    sessionHash: tokenHash,
    memberships: rows.map((r) => ({
      organizationId: r.organizationId,
      role: r.role,
    })),
  };
}
export async function challenge(req: Request) {
  checkOrigin(req);
  const body = z
    .object({
      address,
      chainId: z.number().int(),
      accountType: z.literal("EOA").default("EOA"),
    })
    .strict()
    .parse(await readBody(req));
  const cfg = config();
  if (body.chainId !== cfg.CHAIN_ID)
    throw new ApiError(422, "CHAIN_UNSUPPORTED");
  await rateLimit(`challenge:${body.address.toLowerCase()}`, 10);
  await rateLimit("challenge-global", 300);
  const now = new Date(),
    expires = new Date(now.getTime() + 5 * 60000),
    nonce = randomBytes(24).toString("hex"),
    browser = randomBytes(32).toString("hex"),
    challengeId = id();
  const message = createSiweMessage({
    address: getAddress(body.address),
    chainId: cfg.CHAIN_ID,
    domain: cfg.SIWE_DOMAIN,
    uri: cfg.SIWE_URI,
    version: "1",
    nonce,
    issuedAt: now,
    expirationTime: expires,
    statement:
      "Sign in to TALUNAI synthetic demo. This is not financing consent.",
  });
  await getSql()`INSERT INTO siwe_challenges(id,address,message_hash,browser_hash,expires_at) VALUES(${challengeId},${body.address.toLowerCase()},${hash(message)},${secretHash(browser)},${expires})`;
  return json(
    {
      challengeId,
      message,
      expiresAt: expires.toISOString(),
      accountType: "EOA",
    },
    200,
    { "set-cookie": sessionCookie("talunai_browser", browser, 300) },
  );
}
export async function verify(req: Request) {
  checkOrigin(req);
  const b = z
    .object({
      challengeId: z.string().uuid(),
      message: z.string().max(4096),
      signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    })
    .strict()
    .parse(await readBody(req));
  await rateLimit(`verify:${b.challengeId}`, 10);
  const browser = cookie(req, "talunai_browser");
  if (!browser) throw new ApiError(401, "CHALLENGE_INVALID");
  const sql = getSql(),
    cfg = config();
  const rows =
    await sql`SELECT * FROM siwe_challenges WHERE id=${b.challengeId} AND consumed_at IS NULL AND expires_at>now()`;
  const row = rows[0];
  if (
    !row ||
    row.message_hash !== hash(b.message) ||
    row.browser_hash !== secretHash(browser)
  )
    throw new ApiError(401, "CHALLENGE_INVALID");
  const parsed = parseSiweMessage(b.message),
    now = Date.now();
  if (
    !parsed.address ||
    parsed.address.toLowerCase() !== row.address ||
    parsed.domain !== cfg.SIWE_DOMAIN ||
    parsed.uri !== cfg.SIWE_URI ||
    parsed.chainId !== cfg.CHAIN_ID ||
    parsed.version !== "1" ||
    !parsed.nonce ||
    !parsed.issuedAt ||
    !parsed.expirationTime ||
    parsed.issuedAt.getTime() > now ||
    parsed.expirationTime.getTime() <= now
  )
    throw new ApiError(401, "SIWE_FIELDS_INVALID");
  const publicClient = createPublicClient({
    transport: http(cfg.RPC_HTTP_URL, { timeout: 10000, retryCount: 0 }),
  });
  let code: `0x${string}` | undefined;
  try {
    if ((await publicClient.getChainId()) !== cfg.CHAIN_ID)
      throw new ApiError(503, "RPC_CHAIN_MISMATCH");
    code = await publicClient.getCode({ address: getAddress(row.address) });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "RPC_UNAVAILABLE");
  }
  if (code && code !== "0x")
    throw new ApiError(422, "ACCOUNT_TYPE_UNSUPPORTED");
  let valid = false;
  try {
    valid = await verifyMessage({
      address: getAddress(row.address),
      message: b.message,
      signature: b.signature as `0x${string}`,
    });
  } catch {}
  if (!valid) throw new ApiError(401, "SIGNATURE_INVALID");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  const userId = await sql.begin(async (tx) => {
    const consumed =
      await tx`UPDATE siwe_challenges SET consumed_at=now() WHERE id=${b.challengeId} AND consumed_at IS NULL AND expires_at>now() RETURNING id`;
    if (!consumed.length) throw new ApiError(401, "NONCE_CONSUMED");
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${row.address},0))`;
    const wallets =
      await tx`SELECT user_id FROM wallets WHERE address=${row.address}`;
    const uid = wallets[0]?.user_id ?? id();
    if (!wallets.length) {
      await tx`INSERT INTO users(id,status) VALUES(${uid},'PENDING')`;
      await tx`INSERT INTO wallets(address,user_id) VALUES(${row.address},${uid})`;
    } else {
      const [existing] = await tx`SELECT status FROM users WHERE id=${uid}`;
      if (
        !existing ||
        !["PENDING", "PROVISIONED_SYNTHETIC"].includes(existing.status)
      )
        throw new ApiError(403, "ACCOUNT_INACTIVE");
    }
    await tx`INSERT INTO sessions(token_hash,user_id,wallet,csrf_hash,expires_at) VALUES(${secretHash(token)},${uid},${row.address},${secretHash(csrf)},now()+interval '8 hours')`;
    return uid as string;
  });
  const response = json(
    { userId, csrfToken: csrf, expiresIn: 28800, accountType: "EOA" },
    200,
    { "set-cookie": sessionCookie("talunai_session", token, 28800) },
  );
  response.headers.append("set-cookie", csrfCookie(csrf, 28800));
  response.headers.append(
    "set-cookie",
    sessionCookie("talunai_browser", "", 0),
  );
  return response;
}
export async function logout(req: Request, actor: Actor) {
  await getSql()`UPDATE sessions SET revoked_at=now() WHERE token_hash=${actor.sessionHash}`;
  const response = json({ loggedOut: true }, 200, {
    "set-cookie": sessionCookie("talunai_session", "", 0),
  });
  response.headers.append("set-cookie", csrfCookie("", 0));
  response.headers.append(
    "set-cookie",
    sessionCookie("talunai_browser", "", 0),
  );
  return response;
}
