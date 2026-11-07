import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHops, formatTraceparent, newTrace, parseTraceparent } from '../src/trace.js';
import { DEFAULT_CAST } from '../src/cast.js';
import { withServer } from './helpers.js';

const GOOD = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

test('parseTraceparent accepts the W3C shape and refuses everything else', () => {
  assert.deepEqual(parseTraceparent(GOOD), { traceId: '0af7651916cd43dd8448eb211c80319c', parentId: 'b7ad6b7169203331', flags: '01' });
  for (const bad of [undefined, '', 'x', GOOD.toUpperCase(), `00-${'0'.repeat(32)}-b7ad6b7169203331-01`, `00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`, `${GOOD}-extra`, 5, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-ff`]) assert.equal(parseTraceparent(bad), null);
});

test('one trace id, a distinct valid span id per hop, mock text carries the traceparent; hops differ by stage', () => {
  const trace = newTrace(GOOD);
  assert.equal(trace.traceId, '0af7651916cd43dd8448eb211c80319c');
  const groups = ['privileged'];
  // gateway rejection: 3 hops, the policy is never consulted
  const gw = buildHops({ trace, cast: DEFAULT_CAST, stage: 'gateway', code: 'unauthorized_actor', reason: 'not on the allow-list', tool: 'get_account_balance', amount: null, tier: null, user: 'demoUser', act: { sub: 'rogue' }, groups });
  assert.equal(gw.length, 3);
  assert.ok(gw[2].response.includes('401'));
  // policy deny: 5 hops
  const deny = buildHops({ trace, cast: DEFAULT_CAST, stage: 'policy-deny', code: 'group_entitlement', reason: 'not in the required group', tool: 'get_sensitive_account_details', amount: null, tier: 'Standard', user: 'demoUser', act: { sub: 'demo-agent' }, groups: [] });
  assert.equal(deny.length, 5);
  assert.ok(deny.some((h) => h.label.includes('Directory read')));
  // policy permit: 5 hops ending in dispatch
  const permit = buildHops({ trace, cast: DEFAULT_CAST, stage: 'policy-permit', code: null, reason: 'permits', tool: 'get_account_balance', amount: null, tier: 'Standard', user: 'demoUser', act: { sub: 'demo-agent' }, groups });
  assert.equal(permit.length, 5);
  assert.ok(permit[permit.length - 1].label.includes('attributable'));
  for (const set of [gw, deny, permit]) {
    assert.equal(new Set(set.map((h) => h.traceparent)).size, set.length);
    for (const h of set) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.request.includes(h.traceparent) || h.n === set.length); assert.ok(h.traceparent.includes(trace.traceId)); }
  }
  assert.equal(formatTraceparent('a'.repeat(32), 'b'.repeat(16)), `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
});

test('POST /api/tool returns hops, a traceparent header, and continues a valid incoming trace', async () => {
  await withServer(async (url) => {
    const post = (body, headers = {}) => fetch(`${url}/api/tool`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });
    const c = await (await fetch(`${url}/api/consent`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' })).json();
    let r = await post({ token: c.token, tool: 'get_account_balance' });
    let j = await r.json();
    assert.ok(parseTraceparent(r.headers.get('traceparent')));
    assert.ok(j.hops.length >= 4);
    assert.match(j.traceId, /^[0-9a-f]{32}$/);
    r = await post({ token: c.token, tool: 'get_account_balance' }, { traceparent: GOOD });
    j = await r.json();
    assert.equal(j.traceId, '0af7651916cd43dd8448eb211c80319c');
    r = await post({ token: c.token, tool: 'get_account_balance' }, { traceparent: 'garbage' });
    assert.notEqual((await r.json()).traceId, '0af7651916cd43dd8448eb211c80319c');
  });
});
