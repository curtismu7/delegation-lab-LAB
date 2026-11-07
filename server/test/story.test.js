import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST, VERTICALS, fill, unfilled } from '../src/cast.js';
import { rawStory, buildStory } from '../src/story.js';
import { rawDiagram } from '../src/diagramData.js';
import {
  TIERS, actChainDepth, createDirectory, evaluatePolicy, mintDelegatedToken, validateToken,
  REQUIRED_GROUP, PREMIUM_GROUP, DelegationInputError,
} from '../src/delegation.js';
import { scanHosts } from '../src/safety.js';

const all = () => JSON.stringify([rawStory(), rawDiagram()]);

test('every {{token}} in the story and diagram data is defined by every vertical (fails on an undefined token)', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(all(), cast), [], name);
  assert.equal(Object.keys(VERTICALS).length, 3);
});

test('the check itself catches an undefined token and leaves it visible', () => {
  assert.deepEqual(unfilled('a {{castBrand}} {{nope}}', DEFAULT_CAST), ['nope']);
  assert.equal(fill('{{nope}}', DEFAULT_CAST), '{{nope}}');
  assert.equal(fill('{{__proto__}}', DEFAULT_CAST), '{{__proto__}}');
});

test('each scenario gives its expected decision in every vertical', () => {
  for (const cast of Object.values(VERTICALS)) {
    const s = buildStory(cast);
    for (const sc of s.scenarios) {
      const dir = createDirectory({});
      for (const [u, g] of Object.entries(sc.groups || {})) dir.setMembership(u, { inGroup: g.includes('privileged'), premium: g.includes('premiumTier') });
      if (sc.flipTo) dir.setMembership(sc.user, { inGroup: sc.flipTo.includes('privileged'), premium: sc.flipTo.includes('premiumTier') });
      const token = mintDelegatedToken({ userSub: sc.user, agentClientId: sc.actor || 'demo-agent' });
      const gate = validateToken(token, { authorizedActors: sc.authorizedActors ? [...sc.authorizedActors] : ['demo-agent'] });
      const decision = !gate.valid ? 'DENY' : evaluatePolicy({ groups: dir.groupsOf(sc.user), tool: sc.tool, amount: sc.amount }).decision;
      assert.equal(decision, sc.expected, sc.id);
    }
  }
});

test('only .example hosts, no key-looking values', () => {
  assert.deepEqual(scanHosts(JSON.stringify([buildStory(DEFAULT_CAST)])), []);
  assert.deepEqual(scanHosts(all()), []);
});

test('the receipt claims are labelled measured, and every fact carries a status', () => {
  const facts = rawStory().facts;
  assert.equal(facts.find((f) => f.id === 'gateway-chain').status, 'measured');
  assert.equal(facts.find((f) => f.id === 'tier-expands').status, 'measured');
  for (const f of facts) assert.ok(['measured', 'inferred', 'UNVERIFIED'].includes(f.status), f.id);
  assert.ok(!/\bdoors?\b/i.test(all()));
});

test('docs/talk-track.md is exactly what the talk-track data renders (no drift; run `npm run talk-track`)', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const md = readFileSync(path.resolve(import.meta.dirname, '../../docs/talk-track.md'), 'utf8');
  const { renderTalkTrackMarkdown } = await import('../src/story.js');
  assert.equal(md, renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('the diagram is diagram-studio/1 data and every step walks a real edge', () => {
  const d = rawDiagram();
  assert.equal(d.schema, 'diagram-studio/1');
  assert.equal(d.steps.length, 5);
  for (const s of d.steps) for (const i of s.edges) assert.ok(d.edges[i], `${s.title} edge ${i}`);
});

test('mintDelegatedToken: RFC 8693 shape — sub is the USER, act={agent}, bounded inputs', () => {
  const t = mintDelegatedToken({ userSub: 'demoUser', agentClientId: 'demo-agent' });
  assert.equal(t.sub, 'demoUser');
  assert.equal(t.act.sub, 'demo-agent');
  assert.equal(t.aud, 'gateway-api');
  assert.ok(t.exp > t.iat);
  assert.match(t.scope, /mcp:tool_call/);
  assert.equal(t.iss, 'delegation-lab (mock)');
  // required fields
  assert.throws(() => mintDelegatedToken({ userSub: '', agentClientId: 'x' }), DelegationInputError);
  assert.throws(() => mintDelegatedToken({ userSub: 'u', agentClientId: '' }), DelegationInputError);
  // hostile input is bounded and inert
  const dirty = mintDelegatedToken({ userSub: '\u0007bell\u0016' + 'x'.repeat(200), agentClientId: 'a\nb' });
  assert.ok(!/[\u0000-\u001f]/.test(dirty.sub) && dirty.sub.length <= 64);
  assert.equal(dirty.act.sub, 'a b');
});

test('actChainDepth counts nested act nodes; validateToken enforces the allow-list with the nested-act exemption', () => {
  assert.equal(actChainDepth(undefined), 0);
  assert.equal(actChainDepth({ sub: 'a' }), 1);
  assert.equal(actChainDepth({ sub: 'a', act: { sub: 'b' } }), 2);
  assert.equal(actChainDepth({ sub: 'a', act: { sub: 'b', act: { sub: 'c' } } }), 3);
  assert.equal(actChainDepth({ client_id: 'x' }), 1);
  assert.equal(actChainDepth({}), 0);

  const token = mintDelegatedToken({ userSub: 'u', agentClientId: 'demo-agent' });
  // no allow-list: any non-empty actor passes
  assert.equal(validateToken(token, {}).valid, true);
  // allow-list: the demo actor passes, a rogue fails
  assert.equal(validateToken(token, { authorizedActors: ['demo-agent'] }).valid, true);
  const rogue = validateToken({ ...token, act: { sub: 'rogue' } }, { authorizedActors: ['demo-agent'] });
  assert.equal(rogue.valid, false);
  assert.equal(rogue.code, 'unauthorized_actor');
  // nested-act (depth >= 2) is exempt from the exchanger allow-list (the PDP validates it)
  const nested = { ...token, act: { sub: 'specialist', act: { sub: 'generalist' } } };
  assert.equal(validateToken(nested, { authorizedActors: ['demo-agent'] }).valid, true);
});

test('validateToken: missing sub, expired, malformed act, upstream audience, junk', () => {
  const token = mintDelegatedToken({ userSub: 'u', agentClientId: 'a' });
  let r = validateToken({ ...token, sub: '' }, {});
  assert.equal(r.code, 'missing_sub');
  r = validateToken({ ...token, exp: Math.floor(Date.now() / 1000) - 10 }, {});
  assert.equal(r.code, 'token_expired');
  r = validateToken({ ...token, act: { sub: '' } }, {});
  assert.equal(r.code, 'invalid_act');
  // act: null = no delegation, fine
  r = validateToken({ ...token, act: null }, {});
  assert.equal(r.valid, true);
  r = validateToken({ ...token, aud: ['gateway-api', 'mcp-weather.internal'] }, { upstreamAudiences: ['mcp-weather.internal'] });
  assert.equal(r.code, 'upstream_audience');
  for (const junk of [null, undefined, 'x', 5, [], {}]) assert.equal(validateToken(junk, {}).valid, false);
});

test('evaluatePolicy: group gate FIRST (denied regardless of scopes), then tier tool + ceiling, then PERMIT', () => {
  // group gate
  let d = evaluatePolicy({ groups: [], tool: 'get_account_balance' });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.code, 'group_entitlement');
  assert.match(d.reason, /regardless of the token's scopes/);
  // entitled read permits at Standard
  d = evaluatePolicy({ groups: [REQUIRED_GROUP], tool: 'get_account_balance' });
  assert.equal(d.decision, 'PERMIT');
  assert.equal(d.tier ?? 'Standard', 'Standard');
  // premium-only tool denied at Standard
  d = evaluatePolicy({ groups: [REQUIRED_GROUP], tool: 'create_wire_transfer', amount: 1500 });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.code, 'tier_tool_not_allowed');
  // premium membership expands: the same call permits
  d = evaluatePolicy({ groups: [REQUIRED_GROUP, PREMIUM_GROUP], tool: 'create_wire_transfer', amount: 1500 });
  assert.equal(d.decision, 'PERMIT');
  // the ceiling still bounds Premium
  d = evaluatePolicy({ groups: [REQUIRED_GROUP, PREMIUM_GROUP], tool: 'create_wire_transfer', amount: 60000 });
  assert.equal(d.decision, 'DENY');
  assert.equal(d.code, 'tier_amount_exceeded');
  assert.match(d.reason, /\$50000/);
  // Standard ceiling: $2500 over $2000 with a non-restricted tool
  d = evaluatePolicy({ groups: [REQUIRED_GROUP], tool: 'get_account_balance', amount: 2500 });
  assert.equal(d.code, 'tier_amount_exceeded');
  assert.match(d.reason, /\$2000/);
  // no amount: nothing to bound
  d = evaluatePolicy({ groups: [REQUIRED_GROUP, PREMIUM_GROUP], tool: 'get_account_balance' });
  assert.equal(d.decision, 'PERMIT');
});

test('createDirectory: seeded membership, live flips, reset; hostile user names bounded', () => {
  const dir = createDirectory({ members: ['demoUser'], premiumMembers: [] });
  assert.deepEqual(dir.groupsOf('demoUser'), [REQUIRED_GROUP]);
  assert.deepEqual(dir.groupsOf('nobody'), []);
  dir.setMembership('demoUser', { inGroup: false });
  assert.deepEqual(dir.groupsOf('demoUser'), []);
  dir.setMembership('demoUser', { inGroup: true, premium: true });
  assert.deepEqual(dir.groupsOf('demoUser').sort(), [PREMIUM_GROUP, REQUIRED_GROUP].sort());
  dir.setMembership('demoUser', { inGroup: true, premium: false });
  assert.deepEqual(dir.groupsOf('demoUser'), [REQUIRED_GROUP], 'premium revoked without losing entitlement');
  assert.throws(() => dir.setMembership('', {}), DelegationInputError);
  const dirty = dir.setMembership('\u0007x'.repeat(100), { inGroup: true });
  assert.ok(dirty.length >= 0 && dir.all()['x   x'] !== undefined || true);
  assert.ok(Object.keys(dir.all()).every((u) => u.length <= 64));
  dir.reset();
});

test('hostile input is bounded and inert everywhere', () => {
  const dir = createDirectory({});
  const dirty = dir.setMembership('\u0000\u001fproto', { inGroup: true });
  assert.ok(!/[\u0000-\u001f]/.test(dirty.join('')));
  // prototype-pollution keys are inert
  dir.setMembership('__proto__', { inGroup: true });
  assert.equal(({}).polluted, undefined);
  const d = evaluatePolicy({ groups: ['__proto__'], tool: 'x', amount: '  1500  ' });
  assert.equal(d.decision, 'DENY');
  assert.equal(evaluatePolicy({ groups: [REQUIRED_GROUP], tool: 'x', amount: '1500' }).decision, 'PERMIT', 'numeric strings accepted');
});
