// The delegation + entitlement engine, mirroring the AI-DEMO2 UC1/UC9/UC21 contract in mock.
// Three sources (read-only shapes from the app):
//   - agentMcpTokenService + GatewayTokenPolicy: the delegated token chain. User consent mints a
//     delegated token with act={sub: agentClientId} (RFC 8693 shape); the gateway validates
//     sub/aud/exp, then the act chain: act.sub non-empty (null act = no delegation, fine),
//     the actor must be on the allow-list (unauthorized_actor), and aud must NEVER contain an
//     upstream MCP-server audience.
//   - UC9 group entitlement: a user NOT in the required group is DENIED — regardless of the
//     token's scopes. Live membership flip moves the very next decision (no cache, no re-login).
//   - UC21 entitlement tiers: group membership maps to a tier; the tier caps the amount
//     (Standard 2000, Premium 50000) and restricts high-value tools to the premium tier.
//     Positive least-privilege: membership EXPANDS capability. Fires AFTER the group gate.
// Pure functions + in-process stores: no I/O, no clocks inside the decisions (timestamps injected).

export const LIMITS = { clientId: 64, scope: 200, audience: 100, token: 4096, group: 64, tools: 64 };

export const TIERS = {
  Standard: { maxAmountUsd: 2000, premiumOnlyTools: ['create_wire_transfer', 'withdraw'] },
  Premium: { maxAmountUsd: 50000, premiumOnlyTools: [] },
};

export const DEFAULT_TIER = 'Standard';
export const REQUIRED_GROUP = 'privileged';
export const PREMIUM_GROUP = 'premiumTier';

export class DelegationInputError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, max);

// ── Delegated token (agentMcpTokenService mint shape, mock) ─────────────────
/**
 * Mint a mock delegated token after user consent. The RFC 8693 shape: the exchanged token
 * carries sub = the USER (the resource owner), act = { sub: agentClientId } (who is acting),
 * aud = the gateway audience, exp = now + ttl.
 */
export function mintDelegatedToken({ userSub, agentClientId, gatewayAudience = 'gateway-api', ttlSeconds = 600, now = Date.now, scopes = ['mcp:tool_call'] } = {}) {
  const sub = clean(userSub, LIMITS.clientId);
  const act = clean(agentClientId, LIMITS.clientId);
  const aud = clean(gatewayAudience, LIMITS.audience);
  if (!sub) throw new DelegationInputError('user_required', 'userSub is required: a delegated token always acts for a real human');
  if (!act) throw new DelegationInputError('agent_required', 'agentClientId is required: the act claim names who is acting');
  const iat = Math.floor(now() / 1000);
  return {
    sub,
    act: { sub: act },
    aud,
    scope: scopes.map((s) => clean(s, LIMITS.scope)).filter(Boolean).join(' '),
    iat,
    exp: iat + Math.max(1, Math.min(ttlSeconds, 86400)),
    iss: 'delegation-lab (mock)',
  };
}

/** act chain depth (PingOneAuthorizeClient shape): walk act.act… counting nodes with sub/client_id. */
export function actChainDepth(act) {
  let depth = 0;
  let node = act;
  while (node && typeof node === 'object' && (node.sub || node.client_id)) {
    depth += 1;
    node = node.act;
  }
  return depth;
}

/**
 * Gateway token policy (GatewayTokenPolicy shape): aud/exp already checked; validate the
 * identity claims. Returns { valid, reason, code }.
 *  - sub required (missing_sub)
 *  - act present-but-empty act.sub is malformed (invalid_act); act:null = no delegation, fine
 *  - act.sub must be on the actor allow-list when one is set (unauthorized_actor) —
 *    nested-act chains (depth >= 2) are exempt, the PDP validates them
 *  - aud must never contain an upstream MCP-server audience (upstream_audience)
 *  - exp must be in the future (token_expired)
 */
export function validateToken(token, { authorizedActors = null, upstreamAudiences = [], now = Date.now } = {}) {
  if (token == null || typeof token !== 'object' || Array.isArray(token)) {
    return { valid: false, code: 'invalid_token', reason: 'token missing or malformed' };
  }
  const sub = String(token.sub ?? '').trim();
  if (!sub) return { valid: false, code: 'missing_sub', reason: 'Token missing required sub claim' };
  const exp = Number(token.exp);
  if (Number.isFinite(exp) && exp * 1000 <= now()) {
    return { valid: false, code: 'token_expired', reason: 'Token expired at ' + new Date(exp * 1000).toISOString() };
  }
  const aud = Array.isArray(token.aud) ? token.aud.map((a) => String(a)) : (token.aud != null ? [String(token.aud)] : []);
  const upstream = (upstreamAudiences || []).map((a) => String(a).toLowerCase());
  if (upstream.length && aud.some((a) => upstream.includes(a.toLowerCase()))) {
    return { valid: false, code: 'upstream_audience', reason: 'Token audience names an upstream MCP server: the gateway is not a passthrough' };
  }
  if (token.act != null) {
    const actSub = token.act.sub == null ? '' : String(token.act.sub).trim();
    if (!actSub) return { valid: false, code: 'invalid_act', reason: 'Malformed delegation chain: act.sub is empty' };
    if (actChainDepth(token.act) < 2 && authorizedActors && authorizedActors.length > 0) {
      const allowed = authorizedActors.map((a) => String(a).trim()).filter(Boolean);
      if (!allowed.includes(actSub)) {
        return { valid: false, code: 'unauthorized_actor', reason: `Unauthorized delegation actor: "${actSub}" is not on the actor allow-list` };
      }
    }
  }
  return { valid: true, code: null, reason: 'valid delegation chain' };
}

// ── Group entitlement (UC9) + tiers (UC21) ──────────────────────────────────
/**
 * The policy decision for a gated tool call.
 * Order mirrors the app: group gate FIRST (UC9: not in the required group → DENY regardless of
 * scopes), then the tier capability guard (UC21: restricted tool or amount over the tier
 * ceiling → DENY), then PERMIT. The token must already be gateway-valid.
 *
 * @returns {{ decision: 'PERMIT'|'DENY', code: string|null, reason: string }}
 */
export function evaluatePolicy({ token, groups, requiredGroup = REQUIRED_GROUP, tierPolicy = TIERS, defaultTier = DEFAULT_TIER, tool = null, amount = null, premiumGroup = PREMIUM_GROUP } = {}) {
  const list = Array.isArray(groups) ? groups.map((g) => clean(g, LIMITS.group)) : [];
  if (!list.includes(requiredGroup)) {
    return {
      decision: 'DENY',
      code: 'group_entitlement',
      reason: `The user is not a member of the "${requiredGroup}" group — the policy denies regardless of the token's scopes. Add the user to the group and the very next call is evaluated afresh: the policy decides, not the token.`,
    };
  }
  // Tier: the premium group expands capability; everything else is Standard.
  const tier = list.includes(premiumGroup) ? 'Premium' : defaultTier;
  const cfg = tierPolicy[tier] || tierPolicy[defaultTier];
  if (tool && Array.isArray(cfg.premiumOnlyTools) && cfg.premiumOnlyTools.includes(String(tool).slice(0, LIMITS.tools))) {
    return {
      decision: 'DENY',
      code: 'tier_tool_not_allowed',
      reason: `Entitlement-tier capability — tool "${tool}" is restricted to Premium members. The user's tier is "${tier}". Positive least-privilege: group membership EXPANDS capability.`,
    };
  }
  const amt = typeof amount === 'number' && Number.isFinite(amount) ? amount : (typeof amount === 'string' && amount.trim() !== '' && Number.isFinite(Number(amount)) ? Number(amount) : null);
  if (amt !== null && amt > cfg.maxAmountUsd) {
    return {
      decision: 'DENY',
      code: 'tier_amount_exceeded',
      reason: `Entitlement-tier capability — $${amt} exceeds the "${tier}" tier ceiling of $${cfg.maxAmountUsd}. Premium members have a $${tierPolicy.Premium.maxAmountUsd} ceiling; Standard is capped at $${tierPolicy.Standard.maxAmountUsd}. Promote the user in the directory and the next call moves.`,
    };
  }
  return { decision: 'PERMIT', code: null, reason: `user tier "${tier}" permits ${tool ? `tool "${tool}"` : 'the call'}${amt !== null ? ` at $${amt}` : ''} (ceiling $${cfg.maxAmountUsd})` };
}

// ── Live directory (UC9A live board): membership flips move the next decision ──
export function createDirectory({ members = ['demoUser'], premiumMembers = [] } = {}) {
  const groups = new Map(); // user -> Set of group names
  for (const m of members) groups.set(clean(m, LIMITS.group), new Set([REQUIRED_GROUP]));
  for (const m of premiumMembers) {
    const u = clean(m, LIMITS.group);
    if (!groups.has(u)) groups.set(u, new Set());
    groups.get(u).add(PREMIUM_GROUP);
    groups.get(u).add(REQUIRED_GROUP);
  }
  return {
    groupsOf(user) { return [...(groups.get(clean(user, LIMITS.group)) || [])]; },
    setMembership(user, { inGroup = true, premium = false } = {}) {
      const u = clean(user, LIMITS.clientId);
      if (!u) throw new DelegationInputError('user_required', 'user is required');
      if (!groups.has(u)) groups.set(u, new Set());
      const g = groups.get(u);
      if (inGroup) {
        g.add(REQUIRED_GROUP);
        if (premium) g.add(PREMIUM_GROUP); else g.delete(PREMIUM_GROUP);
      } else {
        g.delete(REQUIRED_GROUP);
        g.delete(PREMIUM_GROUP);
      }
      return this.groupsOf(u);
    },
    all() { return Object.fromEntries([...groups.entries()].map(([u, g]) => [u, [...g]])); },
    reset() { return createDirectory({ members, premiumMembers }); },
  };
}
