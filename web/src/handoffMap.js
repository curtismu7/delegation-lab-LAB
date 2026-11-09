// Customer Agent LAB hands a use case here with ?from=customer-agent&uc=<id>&vertical=<id> (read by the vendored return-link module).
// Preselect only where the catalog id obviously maps to this lab's own scenario or vertical; anything else opens the defaults (strip only).
// UC21 has three scenarios here; it opens the first one (the Standard-tier deny), the others are one click away.
export const UC_SCENARIO = Object.freeze({ UC1: "consent-delegation", UC9: "group-entitlement", UC9A: "live-flip", UC21: "tier-tool" });
export const VERTICAL_MAP = Object.freeze({ banking: "finance", healthcare: "health", retail: "retail" });
export const scenarioFor = (ctx) => (ctx && Object.hasOwn(UC_SCENARIO, ctx.uc) ? UC_SCENARIO[ctx.uc] : null);
export const verticalFor = (ctx) => (ctx && ctx.vertical && Object.hasOwn(VERTICAL_MAP, ctx.vertical) ? VERTICAL_MAP[ctx.vertical] : null);
