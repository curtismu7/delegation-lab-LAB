import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rawHttp, withServer } from './helpers.js';

test('GET /api/shelf returns the configured SHELF_URL with no web build (trailing slash trimmed), and a POST to it is not 200', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/api/shelf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { shelfUrl: 'https://shelf.example:8443' });
    const post = await fetch(`${url}/api/shelf`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.notEqual(post.status, 200);
  }, { env: { SHELF_URL: 'https://shelf.example:8443/' } });
});

test('GET /api/health answers demo-health/1, ready and offline', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'delegation-lab');
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
  });
});

test('health is GET only', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(r.status, 405);
  });
});

test('POST /api/reset confirms and refuses a cross-origin caller', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' });
    assert.equal((await ok.json()).reset, 'ok');
    const bad = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(bad.status, 403);
  });
});

test('a non-loopback Host header is refused (DNS rebinding)', async () => {
  await withServer(async (url) => {
    const r = await rawHttp(`${url}/api/health`, { headers: { host: 'evil.example.invalid' } });
    assert.equal(r.status, 403);
  });
});

test('unknown API paths are 404 JSON', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('GET /api/info says what this build is: mock, simulated, and hosted only when asked', async () => {
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', source: 'mock', simulated: true, hosted: false, realAvailable: false });
    const j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.hosted, false);
    assert.match(j.banner, /^SIMULATED/);
  });
  await withServer(async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/info`)).json(), { mode: 'mock', source: 'mock', simulated: true, hosted: true, realAvailable: false });
    assert.match((await (await fetch(`${url}/api/scenarios`)).json()).banner, /^HOSTED SIMULATION/);
  }, { hosted: true });
});

test('an oversized or malformed body gets a short JSON error, never a stack trace or a file path', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/consent`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body });
    const big = await post(JSON.stringify({ pad: 'x'.repeat(9000) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'payload_too_large' });
    const bad = await post('{not json');
    assert.equal(bad.status, 400);
    const text = JSON.stringify(await bad.json());
    assert.equal(text, JSON.stringify({ error: 'bad_request' }));
    assert.ok(!/\/Users\/|node_modules|at \w+ \(/.test(text), 'no stack or path');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server stays up');
  });
});

test('GET /api/scenarios returns the filled story; customer.config.json is read on each request; verticals switch the cast', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlb-')), 'customer.config.json');
  await withServer(async (url) => {
    let j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.equal(j.scenarios.length, 7);
    assert.ok(!/\{\{/.test(JSON.stringify(j)), 'no unfilled token');
    assert.match(j.tokenLabel, /MOCK/);
    assert.ok(j.facts.some((f) => f.id === 'group-gate' && f.status === 'measured'));
    assert.ok(j.tools.length >= 3, 'the tool list ships with the story');
    j = await (await fetch(`${url}/api/scenarios?vertical=finance`)).json();
    assert.match(j.rule.appliesTo, /fabrikam/);
    j = await (await fetch(`${url}/api/scenarios?vertical=__proto__`)).json();
    assert.match(j.rule.appliesTo, /northwind/, 'unknown vertical keeps the default');
    fs.writeFileSync(file, JSON.stringify({ cast: { host: 'customhost' } }));
    j = await (await fetch(`${url}/api/scenarios`)).json();
    assert.match(j.rule.appliesTo, /customhost/);
  }, { configFile: file });
});

test('UC1: consent mints act={agent}; the entitled balance read permits with the chain in the hops', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const c = await (await post('/api/consent', { user: 'demoUser' }, 'w1')).json();
    assert.equal(c.token.sub, 'demoUser');
    assert.equal(c.token.act.sub, 'demo-agent');
    assert.equal(c.token.aud, 'gateway-api');
    assert.ok(c.token.exp > c.token.iat);
    const r = await post('/api/tool', { token: c.token, tool: 'get_account_balance' }, 'w1');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.decision, 'PERMIT');
    assert.deepEqual(j.groups, ['privileged']);
    assert.equal(j.tier, 'Standard');
    assert.ok(j.hops.some((h) => h.label.includes('act={agent}') || h.request.includes('act=demo-agent')));
  });
});

test('ROGUE ACTOR: act.sub outside the allow-list is refused at the gateway, policy never consulted', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const c = await (await post('/api/consent', { user: 'demoUser', agent: 'rogue-agent' }, 'w2')).json();
    const r = await post('/api/tool', { token: c.token, tool: 'get_account_balance' }, 'w2');
    assert.equal(r.status, 401);
    const j = await r.json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.stage, 'gateway');
    assert.equal(j.code, 'unauthorized_actor');
    assert.match(j.reason, /allow-list/);
  });
});

test('UC9: not in the required group — denied regardless of scopes', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const c = await (await post('/api/consent', { user: 'demoUser' }, 'w3')).json();
    await post('/api/directory/flip', { user: 'demoUser', inGroup: false }, 'w3');
    const r = await post('/api/tool', { token: c.token, tool: 'get_sensitive_account_details' }, 'w3');
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.code, 'group_entitlement');
    assert.match(j.reason, /regardless of the token's scopes/);
  });
});

test('UC9A: flip the membership, the very next call moves (no re-login, per workspace)', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const c = await (await post('/api/consent', { user: 'demoUser' }, 'w4')).json();
    await post('/api/directory/flip', { user: 'demoUser', inGroup: false }, 'w4');
    assert.equal((await post('/api/tool', { token: c.token, tool: 'get_sensitive_account_details' }, 'w4')).status, 403);
    await post('/api/directory/flip', { user: 'demoUser', inGroup: true }, 'w4');
    assert.equal((await post('/api/tool', { token: c.token, tool: 'get_sensitive_account_details' }, 'w4')).status, 200);
    // another workspace is untouched by the flips
    const c2 = await (await post('/api/consent', { user: 'demoUser' }, 'w5')).json();
    assert.equal((await post('/api/tool', { token: c2.token, tool: 'get_sensitive_account_details' }, 'w5')).status, 200, 'w5 never flipped');
  });
});

test('UC21: Standard cannot invoke the premium wire; promotion is instant; the ceiling still bounds Premium', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    const c = await (await post('/api/consent', { user: 'premiumUser' }, 'w6')).json();
    // Standard (in privileged, not premium): the wire tool itself is denied
    let j = await (await post('/api/tool', { token: c.token, tool: 'create_wire_transfer', amount: 1500 }, 'w6')).json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.code, 'tier_tool_not_allowed');
    // promote: the same call now permits
    await post('/api/directory/flip', { user: 'premiumUser', inGroup: true, premium: true }, 'w6');
    j = await (await post('/api/tool', { token: c.token, tool: 'create_wire_transfer', amount: 1500 }, 'w6')).json();
    assert.equal(j.decision, 'PERMIT');
    assert.equal(j.tier, 'Premium');
    // the Premium ceiling still bounds: $60000 exceeds $50000
    j = await (await post('/api/tool', { token: c.token, tool: 'create_wire_transfer', amount: 60000 }, 'w6')).json();
    assert.equal(j.decision, 'DENY');
    assert.equal(j.code, 'tier_amount_exceeded');
    assert.match(j.reason, /\$50000/);
  });
});

test('gateway rejections stop before the policy; hops differ by stage', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    // expired token
    const c = await (await post('/api/consent', { user: 'demoUser' }, 'w7')).json();
    const expired = { ...c.token, exp: Math.floor(Date.now() / 1000) - 10 };
    let j = await (await post('/api/tool', { token: expired, tool: 'get_account_balance' }, 'w7')).json();
    assert.equal(j.stage, 'gateway');
    assert.equal(j.code, 'token_expired');
    assert.ok(j.hops.length === 3, 'gateway rejection: 3 hops, not 5');
    // upstream audience
    j = await (await post('/api/tool', { token: { ...c.token, aud: 'mcp-weather.internal' }, tool: 'get_account_balance' }, 'w7')).json();
    assert.equal(j.code, 'upstream_audience');
    // malformed act
    j = await (await post('/api/tool', { token: { ...c.token, act: { sub: '' } }, tool: 'get_account_balance' }, 'w7')).json();
    assert.equal(j.code, 'invalid_act');
    // missing sub
    j = await (await post('/api/tool', { token: { ...c.token, sub: '' }, tool: 'get_account_balance' }, 'w7')).json();
    assert.equal(j.code, 'missing_sub');
    // no token at all
    assert.equal((await post('/api/tool', { tool: 'x' }, 'w7')).status, 400);
  });
});

test('bad inputs are refused with short JSON', async () => {
  await withServer(async (url) => {
    const post = (p, body, ws = 'w9') => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws }, body: JSON.stringify(body) });
    assert.equal((await post('/api/directory/flip', {}, 'w9')).status, 400);
    assert.equal((await post('/api/directory/flip', { user: 'x' }, 'w9')).status, 400);
    assert.equal((await post('/api/tool', { token: 'junk' }, 'w9')).status, 401);
    assert.equal((await post('/api/tool', { token: {}, tool: 'x', amount: -5 }, 'w9')).status, 400);
    assert.equal((await post('/api/tool', { token: {}, tool: 'x', amount: '   ' }, 'w9')).status, 400);
    assert.equal((await post('/api/tool', { token: {}, tool: 'x', amount: 5_000_000 }, 'w9')).status, 400);
  });
});

test('GET /api/diagram serves the delegation-flow diagram-studio data, uncached', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/diagram`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const j = await r.json();
    assert.equal(j.steps.length, 5);
    assert.ok(j.nodes.some((n) => n.label.includes('Gateway')));
    assert.ok(j.steps[0].say.includes('consent'));
  });
});

test('rule 19: POST /api/mode switches (mock) and answers 409 when Real is not configured', async () => {
  await withServer(async (url) => {
    const post = (body) => fetch(`${url}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
    const ok = await post({ source: 'mock' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { source: 'mock' });
    const conflict = await post({ source: 'real' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, 'real_not_configured');
    assert.equal((await post({ source: 'banana' })).status, 400);
    assert.equal((await post({})).status, 400);
  });
});
