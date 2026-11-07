// One Express app. /api = health, the gated tool call (delegated token in, decision out), the
// consent exchange, the live directory board (UC9A flips), diagram, info and reset. Server state
// is per workspace id (X-Workspace) so one visitor's Reset never touches another's. Loopback
// Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { hostedFrom, modeFrom, realAvailableFrom } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import {
  DEFAULT_TIER, LIMITS, REQUIRED_GROUP, PREMIUM_GROUP, TIERS, actChainDepth,
  createDirectory, evaluatePolicy, mintDelegatedToken, validateToken,
} from './delegation.js';
import { buildHops, newTrace } from './trace.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');

// The demo agent client id — the only actor the gateway's allow-list trusts (plus workspace flips).
const DEMO_AGENT = 'demo-agent';

export function createApp({
  health = createHealth(), configFile = CONFIG, hosted = false,
  workspaces = createWorkspaces(),
  directory = createDirectory({ members: ['demoUser', 'premiumUser'] }),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req), { hosted }), verticals: Object.keys(VERTICALS), hosted }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  // What this build is, for the banner and for verifying a deploy by content (not by a 200).
  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ mode: modeFrom(), source: modeFrom(), simulated: true, hosted, realAvailable: realAvailableFrom() }); });
  // Rule 19: the Mock/Real toggle. Exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !realAvailableFrom()) {
      return res.status(409).json({ error: 'real_not_configured', detail: 'Real mode needs a live policy engine configuration (DLB_REAL_* env, owner-run). Mock keeps working.' });
    }
    return res.json({ source: body.source });
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };

  // The live directory board (UC9A): every workspace starts from the shared seed; flips are
  // per workspace so one visitor's demo never moves another's board.
  api.get('/directory', withWorkspace((ws, req, res) => {
    const v = workspaces.state(ws);
    const dir = v.directory || directory;
    res.json({ groups: dir.all(), workspace: ws, demoAgent: DEMO_AGENT });
  }));
  api.post('/directory/flip', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (typeof body.user !== 'string' || !body.user.trim()) return res.status(400).json({ error: 'user_required', detail: 'body.user must be non-empty text' });
    if (typeof body.inGroup !== 'boolean') return res.status(400).json({ error: 'bad_request', detail: 'body.inGroup must be a boolean' });
    if (body.premium !== undefined && typeof body.premium !== 'boolean') return res.status(400).json({ error: 'bad_request', detail: 'body.premium must be a boolean' });
    const v = workspaces.state(ws);
    const dir = v.directory || createDirectory({});
    const groups = dir.setMembership(body.user.trim().slice(0, LIMITS.clientId), { inGroup: body.inGroup, premium: !!body.premium });
    v.directory = dir;
    workspaces.record(ws, { tool: 'directory-flip', amount: null, decision: 'FLIPPED', reason: `${body.user.trim()} -> ${groups.join(', ') || '(no groups)'}`, receipt: null, blocked: null });
    return res.json({ user: body.user.trim(), groups, workspace: ws });
  }));

  // Consent exchange (UC1): mint the delegated token. act={agent}; the actor allow-list is
  // enforced by the gateway below, not here — minting always succeeds, validation decides.
  api.post('/consent', withWorkspace((ws, req, res) => {
    const body = req.body || {};
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim().slice(0, LIMITS.clientId) : 'demoUser';
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim().slice(0, LIMITS.clientId) : DEMO_AGENT;
    const token = mintDelegatedToken({ userSub: user, agentClientId: agent, now: () => Date.now() });
    const v = workspaces.state(ws);
    workspaces.record(ws, { tool: 'consent-exchange', amount: null, decision: 'MINTED', reason: `delegated token: sub=${token.sub}, act=${token.act.sub}`, receipt: null, blocked: null });
    return res.json({ token, workspace: ws });
  }));

  // The gated tool call: a delegated token + groups in, decision out. Order mirrors the app:
  // gateway chain validation FIRST, then the group gate (UC9), then the tier guard (UC21).
  api.post('/tool', withWorkspace((ws, req, res) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'bad_request' });
    if (body.token == null) return res.status(400).json({ error: 'token_required', detail: 'body.token (the delegated token) is required — consent first' });
    const tool = typeof body.tool === 'string' && body.tool ? body.tool.slice(0, LIMITS.tools) : 'get_account_balance';
    let amount = null;
    if (body.amount !== undefined && body.amount !== null) {
      if (typeof body.amount === 'string' && body.amount.trim() === '') return res.status(400).json({ error: 'bad_amount', detail: 'amount must be a number' });
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return res.status(400).json({ error: 'bad_amount', detail: 'amount must be a non-negative number within range' });
    }
    const v = workspaces.state(ws);
    const dir = v.directory || directory;

    // 1. Gateway: validate the delegated token chain.
    const authorizedActors = [DEMO_AGENT];
    const gate = validateToken(body.token, { authorizedActors, upstreamAudiences: ['mcp-weather.internal'], now: () => Date.now() });
    if (!gate.valid) {
      workspaces.record(ws, { tool, amount, decision: 'DENY', reason: gate.reason, receipt: null, blocked: gate.code });
      const trace = newTrace(req.headers.traceparent);
      const hops = buildHops({ trace, cast: castFor(req), stage: 'gateway', code: gate.code, reason: gate.reason, tool, amount, tier: null });
      res.set('traceparent', hops[0].traceparent);
      return res.status(401).json({ decision: 'DENY', stage: 'gateway', code: gate.code, reason: gate.reason, tool, amount, workspace: ws, traceId: trace.traceId, hops });
    }

    // 2. Policy: group gate, then tier.
    const user = String(body.token.sub || '').slice(0, LIMITS.clientId);
    const groups = dir.groupsOf(user);
    const verdict = evaluatePolicy({ groups, tool, amount });
    workspaces.record(ws, { tool, amount, decision: verdict.decision, reason: verdict.reason, receipt: null, blocked: verdict.code });
    const trace = newTrace(req.headers.traceparent);
    const tier = groups.includes(PREMIUM_GROUP) ? 'Premium' : DEFAULT_TIER;
    const hops = buildHops({ trace, cast: castFor(req), stage: verdict.decision === 'PERMIT' ? 'policy-permit' : 'policy-deny', code: verdict.code, reason: verdict.reason, tool, amount, tier, user, act: body.token.act, groups });
    res.set('traceparent', hops[0].traceparent);
    return res.status(verdict.decision === 'PERMIT' ? 200 : 403).json({
      decision: verdict.decision, stage: 'policy', code: verdict.code, reason: verdict.reason,
      tool, amount, user, groups, tier, workspace: ws, traceId: trace.traceId, hops,
    });
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's directory flips and runs.
  api.post('/reset', withWorkspace((ws, _req, res) => {
    workspaces.resetWorkspace(ws);
    res.json({ reset: 'ok', workspace: ws });
  }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
