import { buildApp } from "./app.ts";

const { app, ctx } = await buildApp({ logger: process.env.LOG_REQUESTS === "true" });
await app.listen({ port: ctx.cfg.port, host: ctx.cfg.host });
console.log(`VICEPULSE server on http://${ctx.cfg.host}:${ctx.cfg.port} · narrative=${ctx.narrative.name} · settlement=${ctx.settlement.adapter.id} · atlas=${ctx.atlas.source} (${ctx.atlas.records.size})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
