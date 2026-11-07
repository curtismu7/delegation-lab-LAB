# HANDOFF — delegation-lab-LAB (Phase 2 cluster 2)

**Read first:** `~/Development/STANDALONE-RULES.md` (the rulebook), `~/Development/AI-DEMO-Standalone/docs/UC-CONVERSION-RECIPE.md` (the conversion recipe this lab follows).

## What this lab is

A standalone mock of the AI-DEMO2 **delegation + entitlement** contract (UC1, UC9, UC9A, UC21):

- **UC1** — user consent mints a delegated token: `sub` = the USER, `act={sub: agent}` (RFC 8693 shape). `mintDelegatedToken` in `server/src/delegation.js`.
- **Gateway chain validation** — `validateToken`: sub/aud/exp, act.sub non-empty (`invalid_act`; `act: null` = no delegation, fine), actor **allow-list** (`unauthorized_actor`; nested-act depth ≥ 2 exempt — the PDP validates those), aud must never name an upstream MCP server (`upstream_audience`). Mirrors AI-DEMO2 `GatewayTokenPolicy` (including its dead-code-allow-list fix).
- **UC9 group gate** — a user outside the `privileged` group is DENIED regardless of scopes. Fires FIRST.
- **UC9A live board** — the directory is read on EVERY decision; `/api/directory/flip` mutates a per-workspace store, so the very next call moves. No cache, no re-login.
- **UC21 tiers** — premium membership EXPANDS capability: `premiumOnlyTools` (Standard denies `create_wire_transfer` etc.) and the ceiling (Standard $2000 / Premium $50000). Distinct codes `tier_tool_not_allowed` / `tier_amount_exceeded`.

Decision order (do not weaken): gateway chain → group gate → tier guard → PERMIT.

## Current state — what is DONE

Everything through rollout except the Playwright UI drive. Evidence:

- **Tests**: 63 server + 13 web + 5 packaging = green. Run `npm ci && npm test` in the repo root.
- **Doctor**: 14/14 (`npm run doctor`; needs port 7690 free — stop the container first).
- **Conformance**: `node ~/Development/demo-kit-base/scripts/conformance.mjs . --new` → 23 PASS, 0 FAIL.
- **Repo**: `curtismu7/delegation-lab-LAB` (private, owner-approved). Head `817764e`, **CI green** on GitHub-hosted runners. FORBIDDEN_STRINGS secret set (other-project identifiers only — the lab's own name legitimately appears in its files; this mirrors the mcp-gateway precedent where the scan must pass with the repo's own name in history).
- **Docker verified by content** on 127.0.0.1:7690: UC1 PERMIT, rogue actor `unauthorized_actor`, UC9 flip loop (`group_entitlement` → flip → PERMIT), UC21 promote → PERMIT + `tier_amount_exceeded` at $60000.
- **Lab-proxy**: route + compose network added in `~/Development/AI-DEMO-Standalone/shared/lab-proxy` (commit `ddcb4f8`, pushed). Domain proof: `https://local.ping-devops.com:8443/delegation-lab/api/health` returns `demo-health/1 … Delegation Lab` (curl with the lab cookie).
- **Meta-repo**: submodule pinned (`1e378f1`, pushed). Board row in `~/Development/STANDALONE-COORDINATION.md` updated with the DONE state. `STANDALONE-PROGRESS.md` has the session log.
- **Shelf**: entry merged into `standalone/demo-shelf-LAB` (commit `45fa3cf`, CI green): catalog row **D120**, catalog-tags, proxyUrl map. Card is LIVE in `/api/shelf` with `proxyUrl: https://local.ping-devops.com:8443/delegation-lab/`.

## What remains (the actual handoff)

1. **Playwright UI drive through the domain** (the hitl-mfa precedent — this is where the last two labs found a real bug):
   - Start the container: `cd ~/Development/AI-DEMO-Standalone/standalone/delegation-lab-LAB && HOST_PORT=7690 docker --context orbstack compose -f docker-compose.yml up --build -d`
   - Drive `https://local.ping-devops.com:8443/delegation-lab/` with the Playwright MCP tools (never curl probes for UI claims; sign-in N/A here).
   - Prove by CONTENT: UC1 scenario → verdict PERMITTED + `who` line shows `act=demo-agent`; UC9 chip → DENIED at the POLICY stage; flip privileged off in the live directory board → re-run the same call → still DENIED, flip on → PERMITTED; rogue agent id in the agent panel → DENIED at the GATEWAY stage (`stage` testid says "GATEWAY refused"); UC21 chips (tier-tool DENY, tier-promote PERMIT, tier-ceiling DENY).
   - Screenshots: desktop + 375px. Append the proof to `STANDALONE-PROGRESS.md` and the board row (remove the "OPEN (handoff …)" note).
2. **Watch for the hitl-mfa-style bug**: the UI's `runScenario` seeds directory membership via `/api/directory/flip` before each scenario — verify the flip actually lands (the mock `onChanged` wiring and per-workspace isolation were reviewed, but only live driving proves the seeded flip + scenario call land in the SAME workspace).
3. **Optional cleanliness**: the first CI run failed on the scaffold's `PORT=7689` doctor probe (fixed to `7699` in `3aec153`); the shelf-entry description went through three length trims (`817764e` is final). Nothing else outstanding.
4. **Then** report done. Next cluster (a2a-lab, UC2/2.5/2.6/2.7, ports 7700–7709) starts only on the owner's word.

## Key files

| File | What it is |
|---|---|
| `server/src/delegation.js` | Pure engine: mint/validate token, actChainDepth, evaluatePolicy, createDirectory |
| `server/src/policyData.js` | Story-as-data: 7 scenarios, facts (all `measured`), talk track |
| `server/src/app.js` | Routes: `/api/consent`, `/api/tool`, `/api/directory(/flip)`, `/api/scenarios|diagram|info|mode|runs|reset` |
| `server/src/trace.js` | W3C traceparent hops; 3 hops on gateway rejection, 5 on a policy walk |
| `web/src/components/PolicyGate.jsx` | Scenario chips, agent call, live directory board, verdict + hops |
| `docs/shelf-entry.json` | Shelf entry (D120) |
| `docs/talk-track.md` | Generated from policyData by `npm run talk-track` — a test fails if they drift |

## Traps (learned the hard way in this repo family)

- **CI doctor probe port**: `.github/workflows/ci.yml` probes `PORT=7699` — it must be inside THIS lab's block, not the scaffold's.
- **FORBIDDEN_STRINGS**: must NOT contain the lab's own name (it appears in tracked files); it lists other projects' identifiers. `gh secret set` BEFORE judging CI.
- **`npm run doctor` needs the port free**: stop the compose container first.
- **Shelf description**: hard cap 300 chars — the validator says `description must be a non-empty string up to 300 characters`.
- **Word filters**: the content-pack test forbids the substring `member` — never say "membership/members" in story data or glossary.
- **catalog-tags.json**: D-entries live under the `tags` KEY, not top-level (top-level keys are silently ignored).
- **Standalone rule**: never run `docker compose` from the meta-repo or a worktree; container names follow `<dir>-<service>-1`.
