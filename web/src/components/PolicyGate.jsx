import { useCallback, useEffect, useRef, useState } from "react";
import Json from "./Json";
import { runTool, getDirectory, flipMembership, consent } from "../api";
import { visible } from "../safeText";

const STATUS_CLASS = { measured: "tag tag--ok", inferred: "tag", UNVERIFIED: "tag tag--warn" };
const DEMO_AGENT = "demo-agent";

export function Hops({ hops, traceId }) {
  return (
    <section aria-label="Mock hops with traceparent" data-testid="hops">
      <h3>Hops (W3C traceparent) <span className="muted">trace {traceId}</span></h3>
      {hops.map((h) => (
        <details key={h.n} open={h.n === 1}>
          <summary>{h.n}. {h.label}</summary>
          <p className="muted">Request</p><Json value={h.request} label={`Request of hop ${h.n}`} />
          <p className="muted">Response</p><Json value={h.response} label={`Response of hop ${h.n}`} />
        </details>
      ))}
    </section>
  );
}

const WORDS = {
  PERMIT: ["allow", "PERMITTED — the policy allows this call; it executed, fully attributable"],
  DENY: ["deny", "DENIED — the policy refused; nothing executed"],
};

export function Verdict({ run }) {
  if (!run) return <p className="muted" data-testid="verdict-empty">Pick a scenario to run it.</p>;
  const [cls, word] = WORDS[run.decision] || ["deny", run.decision];
  return (
    <div className={`verdict verdict--${cls}`} data-testid="verdict" role="status">
      <strong className="verdict__word">{word}</strong>
      {run.stage && <p className="muted" data-testid="stage">Stage: {run.stage === "gateway" ? "the GATEWAY refused the chain" : "the POLICY decided"}</p>}
      {run.reason && <p className="reason" data-reason="policy">{visible(run.reason)}</p>}
      {run.user && <p data-testid="who">Token: sub=<code>{visible(run.user)}</code>, act=<code>{visible(run.act?.sub || "(none)")}</code> — groups [ {(run.groups || []).join(", ")} ], tier {visible(run.tier || "Standard")}</p>}
    </div>
  );
}

/** The agent call: consent once, then run the gated tool. The delegated token is minted on demand. */
function AgentCall({ tools, onResult, user }) {
  const [tool, setTool] = useState(tools[0].name);
  const [amount, setAmount] = useState("");
  const [agent, setAgent] = useState(DEMO_AGENT);
  const [fail, setFail] = useState(null);
  const run = async () => {
    setFail(null);
    const c = await consent({ user, agent: agent || DEMO_AGENT }).catch(() => ({ ok: false, body: {} }));
    if (!c.ok) { setFail("Could not mint the delegated token."); return; }
    const payload = { token: c.body.token, tool };
    if (amount !== "") payload.amount = Number(amount);
    const res = await runTool(payload).catch(() => ({ ok: false, status: 0, body: {} }));
    if (res.body.decision) onResult(res.body);
    else setFail(`Could not evaluate (${res.body.detail || res.body.error || res.status}).`);
  };
  return (
    <section className="panel" aria-labelledby="call-h" data-testid="agent-call">
      <h2 id="call-h">Call the tool as the agent</h2>
      <p className="muted">One agent-originated tools/call: consent mints the delegated token, the gateway validates the chain, then the policy decides from the live directory.</p>
      <label htmlFor="call-user">Acting for (token sub)</label>
      <input id="call-user" type="text" maxLength={64} defaultValue={user} data-testid="call-user" />
      <label htmlFor="call-agent">Agent client id (act.sub)</label>
      <input id="call-agent" type="text" maxLength={64} value={agent} onChange={(e) => setAgent(e.target.value)} data-testid="call-agent" />
      <label htmlFor="call-tool">Tool</label>
      <select id="call-tool" value={tool} onChange={(e) => setTool(e.target.value)}>
        {tools.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.tier})</option>)}
      </select>
      <label htmlFor="call-amount">Amount (USD, optional)</label>
      <input id="call-amount" type="number" min="0" max="1000000" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="call-amount" />
      <button type="button" onClick={run} data-testid="call-run">Consent &amp; call as the agent</button>
      {fail && <p className="field-error" role="alert">{fail}</p>}
    </section>
  );
}

/** The live directory board (UC9A): flip a membership, the very next decision moves. */
function DirectoryBoard({ onChanged }) {
  const [groups, setGroups] = useState(null);
  const [user, setUser] = useState("demoUser");
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    const j = await getDirectory().catch(() => null);
    if (j) setGroups(j.groups);
  }, []);
  useEffect(() => { load(); }, [load, onChanged]);
  const flip = async (premium) => {
    setMsg(null);
    const r = await flipMembership({ user, inGroup: !(groups[user] || []).includes("privileged"), premium }).catch(() => ({ ok: false, body: {} }));
    if (r.ok) { setMsg(`${r.body.user} -> [ ${r.body.groups.join(", ") || "no groups"} ]`); await load(); if (onChanged) onChanged(); }
    else setMsg(r.body.detail || "Could not flip the membership.");
  };
  return (
    <section className="panel" aria-labelledby="dir-h" data-testid="directory-board">
      <h2 id="dir-h">Live directory (UC9A)</h2>
      <p className="muted">Membership is read on EVERY decision. Flip it and the very next call moves — no code change, no cache, no re-login. The flips are per workspace.</p>
      <label htmlFor="dir-user">User</label>
      <input id="dir-user" type="text" maxLength={64} value={user} onChange={(e) => setUser(e.target.value)} data-testid="dir-user" />
      <div className="seg" role="group" aria-label="Membership flips">
        <button type="button" data-testid="flip-privileged" onClick={() => flip(false)}>Flip privileged</button>
        <button type="button" data-testid="flip-premium" onClick={() => flip(true)}>Flip premium</button>
      </div>
      {msg && <p className="muted" role="status" data-testid="dir-msg">{msg}</p>}
      {groups && (
        <ul className="facts" data-testid="dir-groups">
          {Object.entries(groups).map(([u, g]) => <li key={u}><code>{visible(u)}</code>: [ {g.map((x) => visible(x)).join(", ") || "no groups"} ]</li>)}
        </ul>
      )}
    </section>
  );
}

export default function PolicyGate({ story, resetSignal, requestedId, onSelect }) {
  const known = (v) => story.scenarios.some((s) => s.id === v);
  const [id, setId] = useState(known(requestedId) ? requestedId : story.scenarios[0].id);
  useEffect(() => { if (known(requestedId)) setId(requestedId); }, [requestedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [run, setRun] = useState(null);
  const [fail, setFail] = useState(null);
  const scenario = story.scenarios.find((s) => s.id === id) || story.scenarios[0];

  // Run a shipped scenario: set up the directory exactly as the scenario states, then consent + call.
  const runToken = useRef(0);
  const runScenario = useCallback(async (sid) => {
    const token = ++runToken.current;
    const drop = () => token !== runToken.current;
    setFail(null);
    const sc = story.scenarios.find((s) => s.id === sid) || story.scenarios[0];
    // seed the membership for the scenario's user
    const startIn = (sc.groups?.[sc.user] || []).includes("privileged");
    const startPrem = (sc.groups?.[sc.user] || []).includes("premiumTier");
    await flipMembership({ user: sc.user, inGroup: startIn, premium: startPrem }).catch(() => null);
    if (drop()) return;
    if (sc.flipTo) { await flipMembership({ user: sc.user, inGroup: sc.flipTo.includes("privileged"), premium: sc.flipTo.includes("premiumTier") }).catch(() => null); if (drop()) return; }
    const c = await consent({ user: sc.user, agent: sc.actor || DEMO_AGENT }).catch(() => ({ ok: false, body: {} }));
    if (drop()) return;
    if (!c.ok) { setFail("Could not mint the delegated token."); return; }
    const payload = { token: c.body.token, tool: sc.tool };
    if (sc.amount != null) payload.amount = sc.amount;
    const res = await runTool(payload).catch(() => ({ ok: false, status: 0, body: {} }));
    if (drop()) return;
    if (res.body.decision) setRun(res.body); else { setRun(null); setFail(`Could not evaluate (${res.body.detail || res.body.error || res.status}).`); }
  }, [story]);

  useEffect(() => { setRun(null); }, [resetSignal]);
  useEffect(() => { runScenario(id); }, [id, resetSignal, runScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gate">
      <section className="panel" aria-labelledby="sc-h">
        <h2 id="sc-h">Scenarios</h2>
        <div className="seg" role="group" aria-label="Scenario">
          {story.scenarios.map((s) => <button key={s.id} type="button" aria-pressed={s.id === id} onClick={() => { setId(s.id); if (onSelect) onSelect(s.id); }}>{s.title}</button>)}
        </div>
        <p className="lesson" data-testid="lesson">{scenario.lesson}</p>
      </section>
      <section className="panel" aria-labelledby="res-h">
        <h2 id="res-h">Decision</h2>
        {fail && <p className="field-error" role="alert">{fail}</p>}
        <Verdict run={run} />
        {run && <Hops hops={run.hops} traceId={run.traceId} />}
      </section>
      <AgentCall tools={story.tools} onResult={(r) => setRun(r)} user="demoUser" />
      <DirectoryBoard onChanged={() => {}} />
      <section className="panel" aria-labelledby="scen-h">
        <h2 id="scen-h">Scenario (decoded)</h2>
        <p className="tag tag--warn">{story.tokenLabel}</p>
        <Json value={{ user: scenario.user, groups: scenario.groups, flipTo: scenario.flipTo, tool: scenario.tool, amount: scenario.amount, actor: scenario.actor, authorizedActors: scenario.authorizedActors, expected: scenario.expected }} label="Scenario input" testId="scenario-prefs" />
        <h3>What we know, and how well</h3>
        <ul className="facts" data-testid="facts">
          {story.facts.map((f) => <li key={f.id}><span className={STATUS_CLASS[f.status] || "tag"}>{f.status}</span> {visible(f.text)} <span className="muted">({visible(f.source)})</span></li>)}
        </ul>
      </section>
    </div>
  );
}
