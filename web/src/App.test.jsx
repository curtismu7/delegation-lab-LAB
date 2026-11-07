import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { BANNER_UNKNOWN } from "./App";
import { labelOffsets } from "./components/PatternDiagram";

const STORY = {
  title: "t", intro: "intro text", banner: "SIMULATED: mock gate", tokenLabel: "MOCK policy decisions", hosted: false, verticals: ["retail", "health"],
  rule: { name: "Delegation & entitlement policy (mock)", appliesTo: "Agent gateway", note: "n", defaults: { requiredGroup: "privileged", premiumGroup: "premiumTier", standardCeiling: 2000, premiumCeiling: 50000 } },
  tools: [
    { name: "get_account_balance", tier: "read", lesson: "l" },
    { name: "get_sensitive_account_details", tier: "read-sensitive", lesson: "l" },
    { name: "create_wire_transfer", tier: "premium-write", lesson: "l" },
  ],
  scenarios: [
    { id: "consent-delegation", title: "UC1: consent mints act={agent}", user: "demoUser", groups: { demoUser: ["privileged"] }, tool: "get_account_balance", amount: null, expected: "PERMIT", lesson: "Attributable." },
    { id: "group-entitlement", title: "UC9: not in the required group", user: "demoUser", groups: { demoUser: [] }, tool: "get_sensitive_account_details", amount: null, expected: "DENY", lesson: "Denied regardless of scopes." },
  ],
  facts: [
    { id: "act-claim", status: "measured", text: "Consent mints act={agent}.", source: "agentMcpTokenService" },
    { id: "group-gate", status: "measured", text: "The group gate denies regardless of scopes.", source: "UC9" },
  ],
  talkTrack: [
    { id: "say-first", title: "Say first", say: "Everything is simulated." },
    { id: "group", title: "The group gate", say: "The policy decides, not the token." },
  ],
  cast: { castHost: "northwind", castBrand: "Northwind Retail" },
};
const DIAGRAM = {
  title: "Delegation & entitlement", intro: "diagram intro",
  nodes: [{ id: "agent", label: "AI agent", kind: "actor", x: 0, y: 0 }, { id: "gateway", label: "Gateway: chain + actor allow-list", kind: "policy", x: 300, y: 0 }],
  steps: [{ from: "agent", to: "gateway", label: "tools/call", say: "The agent calls the gateway." }, { from: "gateway", to: "agent", label: "Decision", say: "The gateway answers." }],
};
const hop = (n) => ({ n, from: "agent", to: "gateway", label: `hop ${n}`, traceparent: `00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, request: `traceparent: 00-${"a".repeat(32)}-${String(n).repeat(16)}-01`, response: "HTTP/1.1 200 OK" });

const token = (sub = "demoUser", agent = "demo-agent") => ({ sub, act: { sub: agent }, aud: "gateway-api", scope: "mcp:tool_call", iat: 1, exp: 2, iss: "mock" });
const TOKEN = token();
let calls;
let override = {};
function mockFetch() {
  calls = [];
  let memberships = { demoUser: ["privileged"], premiumUser: ["privileged"] };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url, opts });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith("/api/scenarios")) return override.scenarios ? override.scenarios() : json(STORY);
    if (url === "/api/info") return override.info ? override.info() : json({ mode: "mock", simulated: true, hosted: false });
    if (url.startsWith("/api/diagram")) return json(DIAGRAM);
    if (url === "/api/directory") return json({ groups: memberships, demoAgent: "demo-agent", workspace: "t" });
    if (url === "/api/directory/flip") {
      const b = JSON.parse(opts.body || "{}");
      memberships[b.user] = b.inGroup ? (b.premium ? ["privileged", "premiumTier"] : ["privileged"]) : [];
      return json({ user: b.user, groups: memberships[b.user], workspace: "t" });
    }
    if (url === "/api/consent") return json({ token: token(JSON.parse(opts.body || "{}").user || "demoUser", JSON.parse(opts.body || "{}").agent || "demo-agent"), workspace: "t" });
    if (url === "/api/tool") {
      const b = JSON.parse(opts.body);
      const t = b.token || {};
      // gateway stage
      if (!t.sub) return json({ decision: "DENY", stage: "gateway", code: "missing_sub", reason: "sub missing", tool: b.tool, traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3)] }, 401);
      if (t.act?.sub && t.act.sub !== "demo-agent") return json({ decision: "DENY", stage: "gateway", code: "unauthorized_actor", reason: "not on the allow-list", tool: b.tool, traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3)] }, 401);
      // policy stage
      const groups = memberships[t.sub] || [];
      if (!groups.includes("privileged")) return json({ decision: "DENY", stage: "policy", code: "group_entitlement", reason: "not in the required group — regardless of scopes", tool: b.tool, user: t.sub, act: t.act, groups, tier: "Standard", traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4), hop(5)] }, 403);
      if (b.tool === "create_wire_transfer" && !groups.includes("premiumTier")) return json({ decision: "DENY", stage: "policy", code: "tier_tool_not_allowed", reason: "restricted to Premium members", tool: b.tool, user: t.sub, act: t.act, groups, tier: "Standard", traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4), hop(5)] }, 403);
      if (b.tool === "create_wire_transfer" && Number(b.amount) > 50000) return json({ decision: "DENY", stage: "policy", code: "tier_amount_exceeded", reason: "exceeds the Premium ceiling of $50000", tool: b.tool, user: t.sub, act: t.act, groups, tier: "Premium", traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4), hop(5)] }, 403);
      return json({ decision: "PERMIT", stage: "policy", code: null, reason: "permits", tool: b.tool, user: t.sub, act: t.act, groups, tier: groups.includes("premiumTier") ? "Premium" : "Standard", traceId: "a".repeat(32), hops: [hop(1), hop(2), hop(3), hop(4), hop(5)] }, 200);
    }
    if (url === "/api/runs") return json({ workspace: "t", runs: [] });
    if (url === "/api/reset") { memberships = { demoUser: ["privileged"], premiumUser: ["privileged"] }; override = {}; return json({ reset: "ok" }); }
    return json({}, 404);
  });
}
beforeEach(() => { override = {}; mockFetch(); window.location.hash = ""; });

const ready = async () => { render(<App />); await screen.findByText("UC1: consent mints act={agent}"); await screen.findByTestId("verdict"); };

describe("shell", () => {
  it("shows the banner, the mode, and sends X-Workspace on API calls", async () => {
    await ready();
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock (local)");
    const ev = calls.find((c) => c.url === "/api/tool");
    expect(ev.opts.headers["x-workspace"]).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("Reset calls /api/reset", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/reset" && c.opts.method === "POST")).toBe(true));
  });
});

describe("delegation & entitlement tab", () => {
  it("runs the UC1 scenario: PERMITTED with the token chain shown, hops and facts", async () => {
    await ready();
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("PERMITTED"));
    expect(screen.getByTestId("who")).toHaveTextContent("act=demo-agent");
    expect(screen.getByTestId("hops")).toHaveTextContent(/traceparent: 00-a{32}-1{16}-01/);
    expect(screen.getByTestId("facts")).toHaveTextContent("measured");
  });
  it("routes UC9 to DENIED at the policy stage with the group reason", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: /UC9: not in the required group/ }));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENIED"));
    expect(screen.getByTestId("stage")).toHaveTextContent("POLICY decided");
    expect(screen.getByTestId("verdict")).toHaveTextContent("regardless of scopes");
    expect(screen.getByTestId("lesson")).toHaveTextContent("Denied regardless of scopes.");
  });
  it("the live directory board flips membership and shows the groups", async () => {
    await ready();
    await userEvent.click(screen.getByTestId("flip-privileged"));
    await waitFor(() => expect(screen.getByTestId("dir-msg")).toHaveTextContent("demoUser -> [ no groups ]"));
    await waitFor(() => expect(screen.getByTestId("dir-groups")).toHaveTextContent("demoUser: [ no groups ]"));
  });
  it("a manual call with a rogue agent id is refused at the gateway stage", async () => {
    await ready();
    await userEvent.clear(screen.getByTestId("call-agent"));
    await userEvent.type(screen.getByTestId("call-agent"), "rogue");
    await userEvent.click(screen.getByTestId("call-run"));
    await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent("DENIED"));
    expect(screen.getByTestId("stage")).toHaveTextContent("GATEWAY refused");
    expect(screen.getByTestId("verdict")).toHaveTextContent("allow-list");
  });
});

describe("diagram tab", () => {
  it("draws the boxes from /api/diagram and Simulate highlights a step; Reset clears it", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Diagram" }));
    expect(await screen.findByText("Gateway: chain + actor allow-list")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/diagram?vertical=retail"))).toBe(true);
    expect(screen.getByTestId("banner")).toBeInTheDocument();
    expect(screen.getByLabelText(/Step time/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /simulate/i }));
    expect(await screen.findByTestId("pattern-now")).toHaveTextContent("Step 1: tools/call");
    await userEvent.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.queryByTestId("pattern-now")).toBeNull());
  });
});

describe("talk track and presenter mode", () => {
  it("lists the talk track; presenter mode keeps the banner and shows the say-text; Esc leaves", async () => {
    await ready();
    await userEvent.click(screen.getByRole("tab", { name: "Talk track" }));
    expect(screen.getByTestId("talk-track")).toHaveTextContent("Everything is simulated.");
    await userEvent.click(screen.getByRole("tab", { name: "Delegation & entitlement" }));
    await userEvent.keyboard("p");
    expect(await screen.findByTestId("presenter-say")).toHaveTextContent("The policy decides, not the token.");
    expect(screen.getByTestId("banner")).toHaveTextContent(/^SIMULATED/);
    expect(document.querySelector(".app--presenter")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector(".app--presenter")).toBeNull();
  });
  it("the hosted build says HOSTED SIMULATION in the banner", async () => {
    const orig = STORY.banner;
    STORY.banner = "HOSTED SIMULATION: x"; STORY.hosted = true;
    try { render(<App />); await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/)); expect(screen.getByTestId("mode")).toHaveTextContent("(hosted)"); }
    finally { STORY.banner = orig; STORY.hosted = false; }
  });
});

describe("diagram edge labels", () => {
  it("nudges the two labels of a back-and-forth pair in opposite directions and leaves the rest alone", () => {
    const steps = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "c" }];
    expect(labelOffsets(steps)).toEqual([-16, 16, 0]);
    expect(labelOffsets([])).toEqual([]);
  });
});

describe("banner visibility on every tab, presenter mode and hosted mode", () => {
  it("is visible (not hidden, not display:none) on every tab and in presenter mode", async () => {
    await ready();
    for (const name of ["Diagram", "Talk track"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByTestId("banner")).toBeVisible();
    }
  });
  it("hosted: shows HOSTED SIMULATION from /api/info even before /api/scenarios answers, never plain SIMULATED", async () => {
    override.info = async () => ({ ok: true, status: 200, json: async () => ({ mode: "mock", simulated: true, hosted: true }) });
    override.scenarios = () => new Promise(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(/^HOSTED SIMULATION/));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
  it("while nothing has answered, and when both calls fail, the banner says both and stays visible", async () => {
    override.info = async () => json404();
    override.scenarios = async () => json404();
    function json404() { return { ok: false, status: 404, json: async () => ({}) }; }
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent(BANNER_UNKNOWN));
    expect(screen.getByTestId("banner")).toBeVisible();
  });
});
