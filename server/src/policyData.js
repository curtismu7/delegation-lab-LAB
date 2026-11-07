// The story as data: delegation and entitlement — consent mints a delegated token (act={agent}),
// the gateway validates the chain, and the policy decides by group entitlement and tier.
// Mirrors the AI-DEMO2 UC1/UC9/UC21 contract in mock. Text is {{token}} templated (see cast.js).
// Every host ends in .example. No real credential, tenant or customer.

export const BANNER = 'SIMULATED: a mock delegated token chain, a mock gateway policy and a mock entitlement directory. Nothing here calls a real identity provider, policy engine or tenant.';
export const HOSTED_BANNER = 'HOSTED SIMULATION: a mock delegated token chain, a mock gateway policy and a mock entitlement directory. Nothing here calls a real identity provider, policy engine or tenant.';

export const TITLE = "Delegation & entitlement: {{castBrand}}'s agent acts for a consenting human";
export const INTRO = 'The user consents once; token exchange mints a delegated token with act={agent}. The gateway validates the chain (actor allow-list, never an upstream audience), then the policy decides by group entitlement and tier — the directory is read on EVERY decision, so flipping a directory entry moves the very next call.';

// status: measured = seen live in AI-DEMO2; inferred = our reading; UNVERIFIED = not confirmed.
export const FACTS = [
  { id: 'act-claim', status: 'measured', text: 'After consent, RFC 8693 token exchange mints a delegated token: sub is the USER, act={sub: agent} names the actor. Every action traces back to a real human — a chain of custody, not guesswork.', source: 'AI-DEMO2 agentMcpTokenService, enforced live 2026-11-06' },
  { id: 'gateway-chain', status: 'measured', text: 'The gateway validates sub/aud/exp, then the act chain: act.sub non-empty (act:null = no delegation, fine), the actor on the allow-list, and aud must NEVER name an upstream MCP server — the gateway is not a passthrough.', source: 'AI-DEMO2 GatewayTokenPolicy (the actor allow-list was dead code until fixed: any client that could obtain a token satisfied the chain)' },
  { id: 'group-gate', status: 'measured', text: 'A user NOT in the required group is DENIED regardless of the token\'s scopes. The directory groups are read for every decision: add the user to the group and the very next call is evaluated afresh — the policy decides, not the token.', source: 'AI-DEMO2 UC9 group entitlement' },
  { id: 'live-board', status: 'measured', text: 'Group entitlement is a live policy surface, not a one-off chip result: the board flips a directory entry with a real write and watches every vertical\'s decision move — no code change, no cache, no re-login.', source: 'AI-DEMO2 UC9A live board (/group-policy)' },
  { id: 'tier-expands', status: 'measured', text: 'Positive least-privilege: group entitlement EXPANDS capability. The premium tier gets high-value tools and a higher ceiling (Standard $2000 vs Premium $50000); a Standard user\'s agent is not even offered the restricted tools.', source: 'AI-DEMO2 UC21 entitlement tiers' },
  { id: 'tier-instant', status: 'measured', text: 'Promoting a user to a higher tier in the directory immediately changes what their agent can do — no code change, no redeploy. Tier fires AFTER the group gate, so a user must pass entitlement before tier capability is evaluated.', source: 'AI-DEMO2 simulatedAuthorizeService tier guard (NNP-8)' },
  { id: 'tier-restricted', status: 'measured', text: 'Standard tier denies the premium-only tools and amounts over the $2000 ceiling with a distinct reason (tier_tool_not_allowed / tier_amount_exceeded) — not the generic global-ceiling deny.', source: 'AI-DEMO2 simulatedAuthorizeService (decision.js Rule 3d parity)' },
];

export const RULE = {
  name: 'Delegation & entitlement policy (mock)',
  appliesTo: 'Agent gateway https://gateway.{{castHost}}.example/mcp/tool',
  note: 'Mock shape of the gateway token policy + group/tier entitlement. Not exported from, or checked against, a real policy engine.',
  defaults: { requiredGroup: 'privileged', premiumGroup: 'premiumTier', standardCeiling: 2000, premiumCeiling: 50000 },
};

export const TOOLS = [
  { name: 'get_account_balance', tier: 'read', lesson: 'The consent-only read: permitted for any entitled user.' },
  { name: 'get_sensitive_account_details', tier: 'read-sensitive', lesson: 'The group-gated sensitive read: DENY when the user is not in the required group.' },
  { name: 'create_wire_transfer', tier: 'premium-write', lesson: 'The premium-only wire: Standard tier is denied the tool itself; Premium has a $50000 ceiling.' },
];

export const SCENARIOS = [
  {
    id: 'consent-delegation',
    title: 'UC1: consent mints act={agent}, the balance read permits',
    user: 'demoUser', groups: { demoUser: ['privileged'] }, tool: 'get_account_balance', amount: null,
    expected: 'PERMIT',
    lesson: 'The user consented; the delegated token carries sub=user, act={agent}. The chain validates and the entitled read permits — fully attributable.',
  },
  {
    id: 'actor-allowlist',
    title: 'ROGUE ACTOR: an unknown agent is refused at the gateway',
    user: 'demoUser', groups: { demoUser: ['privileged'] }, tool: 'get_account_balance', amount: null,
    actor: 'rogue-agent', authorizedActors: ['demo-agent'],
    expected: 'DENY',
    lesson: 'The actor allow-list: act.sub must name a registered agent. An unauthorized actor is refused before the policy is even consulted (the app fixed this check being dead code).',
  },
  {
    id: 'group-entitlement',
    title: 'UC9: not in the required group — denied regardless of scopes',
    user: 'demoUser', groups: { demoUser: [] }, tool: 'get_sensitive_account_details', amount: null,
    expected: 'DENY',
    lesson: 'The group gate fires first: a user outside the required group is denied no matter what the token carries. The directory groups are read on every decision.',
  },
  {
    id: 'live-flip',
    title: 'UC9A: flip the directory entry, the very next call moves',
    user: 'demoUser', groups: { demoUser: [] }, flipTo: ['privileged'], tool: 'get_sensitive_account_details', amount: null,
    expected: 'PERMIT',
    lesson: 'Live directory: the first call denies; flip the directory entry; the identical call now permits — no code change, no cache, no re-login.',
  },
  {
    id: 'tier-tool',
    title: 'UC21: Standard tier cannot invoke the premium wire',
    user: 'premiumUser', groups: { premiumUser: ['privileged'] }, tool: 'create_wire_transfer', amount: 1500,
    expected: 'DENY',
    lesson: 'Positive least privilege: the premium-only tool is denied for a non-Premium user with a distinct reason — the agent of a Standard user is not even offered it.',
  },
  {
    id: 'tier-promote',
    title: 'UC21: promote to Premium — the same call now permits',
    user: 'premiumUser', groups: { premiumUser: ['privileged'] }, flipTo: ['privileged', 'premiumTier'], tool: 'create_wire_transfer', amount: 1500,
    expected: 'PERMIT',
    lesson: 'Directory-driven tiers: adding the premiumTier group instantly expands the tool set and raises the ceiling to $50000. Policy-driven, not hard-coded.',
  },
  {
    id: 'tier-ceiling',
    title: 'UC21: $60000 exceeds even the Premium ceiling',
    user: 'premiumUser', groups: { premiumUser: ['privileged', 'premiumTier'] }, tool: 'create_wire_transfer', amount: 60000,
    expected: 'DENY',
    lesson: 'The tier ceiling applies to Premium too: $60000 exceeds $50000 and is denied with tier_amount_exceeded — capability expanded, still bounded.',
  },
];

export const TALK_TRACK = [
  { id: 'say-first', title: 'Say first', say: 'Everything here is simulated: the token chain, the directory and the tiers are mock, mirroring what we ran live in AI-DEMO2.' },
  { id: 'consent', title: 'Consent to act', say: 'One consent mints a delegated token: sub is the user, act={agent} names the actor. Every action traces to a real human — chain of custody for audit.' },
  { id: 'gateway', title: 'The gateway validates', say: 'sub/aud/exp, then the act chain: non-empty act.sub, the actor on the allow-list, never an upstream MCP audience. The app fixed this check being dead code — the allow-list now bites.' },
  { id: 'group', title: 'The group gate', say: 'A user outside the required group is denied regardless of scopes. Membership is read on every decision: flip it and the next call moves. The policy decides, not the token.' },
  { id: 'tier', title: 'Tiers expand capability', say: 'Positive least privilege: the premium group expands the tool set and raises the ceiling ($2000 → $50000). Promotion is instant — no code change, no redeploy.' },
  { id: 'unverified', title: 'What we do not claim', say: 'The mock token, groups and ceilings are demo values; the decision contract follows what we enforced live. No real directory write happens here — the flip is a mock store.' },
  { id: 'close', title: 'Close', say: 'Reset clears your workspace: directory flips, runs and tokens. Nothing was sent anywhere.' },
];
