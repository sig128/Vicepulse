import { buildApp } from "../app.ts";

// Seeds reward campaigns and the shared demonstration world (idempotent).
const { app, ctx } = await buildApp({ startSimulation: false });
const shared = await ctx.sim.ensureShared();
console.log(`Shared world ${shared.id} at seq ${shared.seq}; campaigns: ${ctx.ledger.summary("none").campaigns.map((c) => c.id).join(", ")}`);
await app.close();
