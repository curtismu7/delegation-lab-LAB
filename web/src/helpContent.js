// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "An agent attempts a money movement; a mock authorization policy decides by amount band — PERMIT below the confirm bar, human consent (HITL) in the confirm band, MFA step-up at the MFA bar, hard DENY above the ceiling — and CIBA requests out-of-band approval on the user's own device for a sensitive agent-initiated action, regardless of amount.",
      "It is the standalone mock of the AI-DEMO2 HITL track (UC7 / UC8 / UC22 and the authorizeObligations / hitlCredit / CIBA services): same decision contract, no real policy engine or tenant."
    ]
  },
  {
    heading: "Measured vs simulated vs UNVERIFIED",
    body: [
      "MEASURED (in AI-DEMO2, not here): the amount bands were verified live — $300 → HITL, $600 → step-up, $2500 → DENY. The decision contract follows what was enforced there.",
      "SIMULATED: the delegated token chain, the gateway policy and the entitlement directory are all mock. The directory flip is a mock store — no real directory write happens. The demo OTP 123123 and every decision value are labelled demo values.",
      "UNVERIFIED / not claimed: nothing here calls a real gateway, identity provider or tenant. Approvals are receipts, not vibes — but the receipts are mock too."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs: Delegation & entitlement, Diagram, Talk track.",
      "On Delegation & entitlement: pick a scenario from the numbered Scenarios buttons (1 Call the tool as the agent's setup, 2 Decision, 3 'Consent & call as the agent' to run it, 4 Live directory (UC9A) with 'Flip privileged' and 'Flip premium' buttons, 5 Scenario (decoded)). The scenario titles are the claims: 'UC1: consent mints act={agent}, the balance read permits', 'ROGUE ACTOR: an unknown agent is refused at the gateway', 'UC9: not in the required group — denied regardless of scopes', 'UC9A: flip the directory entry, the very next call moves', 'UC21: Standard tier cannot invoke the premium wire', 'UC21: promote to Premium — the same call now permits', 'UC21: $60000 exceeds even the Premium ceiling'.",
      "Diagram: ReactFlow with Simulate and 'Reset positions and walkthrough'. Top menu: mode toggle, vertical picker, Reset, Presenter (P)."
    ]
  },
  {
    heading: "Mode honesty",
    body: "Mock is the story: fully offline (mock gate, mock MFA, mock CIBA). Real is owner-run and RESERVED in this build — the toggle reports the configured environment, but no live policy-engine data path is wired yet, and an unconfigured switch is disabled with a how-to tooltip. The header badge says Real or Mock."
  },
  {
    heading: "The three ideas, in one line each",
    body: [
      "One policy, four bands — change the bands and the same call flips, read on every request, no restart.",
      "Highest gate wins: DENY > STEP_UP > HITL, and the most-specific obligation classification, so one intent can never gate twice.",
      "Approvals are receipts: single-use (a replay re-challenges), amount-bound (approving $300 cannot discharge $600), and the MFA credit expires after five minutes. CIBA triggers on agent context plus sensitivity, not amount."
    ]
  }
];
