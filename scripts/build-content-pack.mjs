// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { 'consent-delegation': ['delegation'], 'actor-allowlist': ['delegation'], 'group-entitlement': ['entitlement'], 'live-flip': ['entitlement'], 'tier-tool': ['entitlement'], 'tier-promote': ['entitlement'], 'tier-ceiling': ['entitlement'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'delegation-lab',
    title: 'Delegation Lab',
    version,
    demo: { id: 'delegation-lab', name: 'Delegation Lab', catalog: 'D120', baseUrl: 'http://localhost:7690', doctor: '/api/health', tags: ['delegation', 'entitlement', 'authorize', 'oauth', 'policy', 'mock-only'] },
    glossary: [
      { id: 'delegation', term: 'Delegated token (act claim)', definition: 'After user consent, RFC 8693 token exchange mints a delegated token: sub is the USER, act={sub: agent} names the actor. Every action traces back to a real human — a chain of custody, not guesswork.', aliases: ['token exchange', 'act claim'] },
      { id: 'entitlement', term: 'Group entitlement & tiers', definition: 'The policy reads directory groups on EVERY decision: a user outside the required group is denied regardless of scopes, and the premium group EXPANDS capability (restricted tools + a higher amount ceiling). Promotion is instant — no code change, no redeploy.', aliases: ['group gate', 'tier'] },
    ],
    sources: [
      { id: 'mcp-tools', title: 'Model Context Protocol: tools/call', url: 'https://modelcontextprotocol.io/docs/concepts/tools', kind: 'standard', use: 'The JSON-RPC tool-call shape the transfer gate scopes.', status: 'not-read', checked: '2026-11-06' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-editor', label: 'Reconfigure the policy live', description: 'Change the amount bands live; the SAME call flips on the next run — a crossing edit falls back to the defaults, never wider.', group: 'concept', action: { type: 'route', href: '/#policy' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
