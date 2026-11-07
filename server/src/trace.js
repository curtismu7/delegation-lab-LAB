// Rule 14: W3C Trace Context on every (mock) hop. One trace id per decision, a new span id per hop. A valid incoming
// `traceparent` header continues its trace; anything else starts a new one. Nothing is sent anywhere: these are the raw
// request/response panes the UI shows. Values are random, mock, and carry no meaning outside this app.
import { randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  // all-ones flags are forbidden by the W3C spec
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 && m[3] !== 'ff' ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;

export function newTrace(incoming, rand = randomBytes) {
  const p = parseTraceparent(incoming);
  const span = () => rand(8).toString('hex').replace(/^0{16}$/, '0000000000000001');
  return { traceId: p ? p.traceId : rand(16).toString('hex').replace(/^0{32}$/, `${'0'.repeat(31)}1`), parentId: p ? p.parentId : null, span };
}

// The mock hops of one gated call, with the raw request and response text of each.
// Hops differ by stage: a gateway rejection stops early; a policy pass walks the full chain.
export function buildHops({ trace, cast, stage, code, reason, tool, amount, tier, user, act, groups }) {
  const host = `gateway.${cast.castHost}.example`;
  const span = () => trace.span();
  const tp = (id) => formatTraceparent(trace.traceId, id);
  const ids = [span(), span(), span(), span(), span()];
  const tokenDesc = user ? `sub=${user}, act=${act ? act.sub : '(none)'}` : '<malformed token>';
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: amount != null ? { amount } : {} } });
  const hops = [
    { n: 1, from: 'agent', to: 'gateway', label: 'Agent calls the tool with the delegated token', traceparent: tp(ids[0]),
      request: `POST https://${host}/mcp/tool\nAuthorization: Bearer <delegated: ${tokenDesc}>\ntraceparent: ${tp(ids[0])}\ncontent-type: application/json\n\n${body}`,
      response: `traceparent: ${tp(ids[0])}` },
    { n: 2, from: 'gateway', to: 'gateway', label: 'Gateway validates the chain: sub/aud/exp, act.sub, actor allow-list', traceparent: tp(ids[1]),
      request: `validateToken(${tokenDesc})\ntraceparent: ${tp(ids[1])}`,
      response: stage === 'gateway' ? `REJECTED: ${code}\n${reason}` : `valid: ${reason}` },
  ];
  if (stage === 'gateway') {
    hops.push(
      { n: 3, from: 'gateway', to: 'agent', label: 'Refused at the gateway: the policy is never consulted', traceparent: tp(ids[2]),
        request: `GATE-RESULT (mock)\ntraceparent: ${tp(ids[2])}`,
        response: `HTTP/1.1 401\ncode: ${code}\n${reason}` },
    );
    return hops;
  }
  hops.push(
    { n: 3, from: 'gateway', to: 'authz', label: 'Policy evaluates: group gate first, then the tier guard', traceparent: tp(ids[2]),
      request: `evaluatePolicy(groups: [${(groups || []).join(', ')}], tool: ${tool}, amount: ${amount != null ? amount : 'n/a'})\ntraceparent: ${tp(ids[2])}`,
      response: `${stage === 'policy-permit' ? 'PERMIT' : 'DENY'}${code ? `\ncode: ${code}` : ''}\n${reason}` },
    { n: 4, from: 'authz', to: 'directory', label: 'Directory read: membership + tier, every decision', traceparent: tp(ids[3]),
      request: `groupsOf(${user || '?'})\ntraceparent: ${tp(ids[3])}`,
      response: `groups: [${(groups || []).join(', ')}]\ntier: ${tier || 'Standard'}` },
  );
  if (stage === 'policy-permit') {
    hops.push(
      { n: 5, from: 'authz', to: 'tool', label: 'PERMIT: dispatch, fully attributable', traceparent: tp(ids[4]),
        request: `dispatch ${tool}${amount != null ? ` (${amount})` : ''}\ntraceparent: ${tp(ids[4])}`,
        response: `HTTP/1.1 200\nchain: sub=${user || '?'} -> act=${act ? act.sub : '?'} -> PERMIT` },
    );
  } else {
    hops.push(
      { n: 5, from: 'authz', to: 'agent', label: 'DENY: the directory decides, not the token', traceparent: tp(ids[4]),
        request: `GATE-RESULT (mock)\ntraceparent: ${tp(ids[4])}`,
        response: `HTTP/1.1 403\ncode: ${code}\n${reason}` },
    );
  }
  return hops;
}
