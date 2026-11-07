// Deployment configuration: the MODE switch (rule 18) and the Mock/Real toggle (rule 19).
// One image serves the local standalone and the hosted SE build.
// Mock is the only fully-offline mode. Real (owner-run) is configured via the environment:
// DLB_REAL_URL + DLB_REAL_CLIENT_ID + DLB_REAL_CLIENT_SECRET (owner-verified; agents never use live
// credentials). This lab's Real mode is RESERVED: the toggle mechanics follow rule 19 (409 when unconfigured,
// disabled tooltip), and a configured Real mode reports realAvailable — but this build has no live-gateway
// data path yet, so Mock stays the story until a Real backend is wired in.
// When Real is not configured, POST /api/mode answers 409 and the toggle is disabled with a how-to tooltip.

// Which real configuration exists (never the values — only whether they are present).
export function realAvailableFrom(env = process.env) {
  return Boolean(env.DLB_REAL_URL && env.DLB_REAL_CLIENT_ID && env.DLB_REAL_CLIENT_SECRET);
}

// The launch mode (rule 18). Default: Real if configured, else Mock.
export function modeFrom(env = process.env) {
  if (env.MODE === undefined || env.MODE === '') return realAvailableFrom(env) ? 'real' : 'mock';
  const m = env.MODE;
  if (m !== 'mock' && m !== 'real') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has mock and real modes`);
  if (m === 'real' && !realAvailableFrom(env)) throw new Error('MODE=real requested but the Real configuration (DLB_REAL_* env) is not present');
  return m;
}

// DLB_HOSTED=1 marks the SE build: the banner says HOSTED SIMULATION. It changes wording only, never behaviour.
export const hostedFrom = (env = process.env) => env.DLB_HOSTED === '1';
