# Talk track

<!-- Generated from server/src/policyData.js by `npm run talk-track`. Do not edit by hand. -->

## Say first

Everything here is simulated: the token chain, the directory and the tiers are mock, mirroring what we ran live in AI-DEMO2.

## Consent to act

One consent mints a delegated token: sub is the user, act={agent} names the actor. Every action traces to a real human — chain of custody for audit.

## The gateway validates

sub/aud/exp, then the act chain: non-empty act.sub, the actor on the allow-list, never an upstream MCP audience. The app fixed this check being dead code — the allow-list now bites.

## The group gate

A user outside the required group is denied regardless of scopes. Membership is read on every decision: flip it and the next call moves. The policy decides, not the token.

## Tiers expand capability

Positive least privilege: the premium group expands the tool set and raises the ceiling ($2000 → $50000). Promotion is instant — no code change, no redeploy.

## What we do not claim

The mock token, groups and ceilings are demo values; the decision contract follows what we enforced live. No real directory write happens here — the flip is a mock store.

## Close

Reset clears your workspace: directory flips, runs and tokens. Nothing was sent anywhere.

## The scenarios

1. **UC1: consent mints act={agent}, the balance read permits.** The user consented; the delegated token carries sub=user, act={agent}. The chain validates and the entitled read permits — fully attributable.
2. **ROGUE ACTOR: an unknown agent is refused at the gateway.** The actor allow-list: act.sub must name a registered agent. An unauthorized actor is refused before the policy is even consulted (the app fixed this check being dead code).
3. **UC9: not in the required group — denied regardless of scopes.** The group gate fires first: a user outside the required group is denied no matter what the token carries. The directory groups are read on every decision.
4. **UC9A: flip the directory entry, the very next call moves.** Live directory: the first call denies; flip the directory entry; the identical call now permits — no code change, no cache, no re-login.
5. **UC21: Standard tier cannot invoke the premium wire.** Positive least privilege: the premium-only tool is denied for a non-Premium user with a distinct reason — the agent of a Standard user is not even offered it.
6. **UC21: promote to Premium — the same call now permits.** Directory-driven tiers: adding the premiumTier group instantly expands the tool set and raises the ceiling to $50000. Policy-driven, not hard-coded.
7. **UC21: $60000 exceeds even the Premium ceiling.** The tier ceiling applies to Premium too: $60000 exceeds $50000 and is denied with tier_amount_exceeded — capability expanded, still bounded.
