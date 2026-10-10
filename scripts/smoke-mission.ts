// Plays The Night Shift end-to-end against a running server with DEMO_CONTROLS=true.
// Usage: pnpm tsx scripts/smoke-mission.ts [baseUrl] [driver] [route] [precaution|-]
const base = process.argv[2] ?? "http://localhost:8787";
const driver = process.argv[3] ?? "nico";
const route = process.argv[4] ?? "causeway";
const precaution = process.argv[5] ?? "-";
let cookie = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const json: any = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const show = (label: string, r: any) => {
  const v = r.json.view;
  const m = v?.mission;
  console.log(`${label.padEnd(26)} ${r.status} ${v?.clock ?? ""} stage=${m?.stage ?? "-"}`, r.json.error ? `ERR ${r.json.error}: ${r.json.message}` : "",
    m?.complication ? `complication=${m.complication.kind}` : "", m?.outcome ? `outcome=${m.outcome.kind}` : "", r.json.rewards?.length ? `rewards=${JSON.stringify(r.json.rewards)}` : "");
  return v;
};

async function main() {
  await call("GET", "/api/me");
  await call("POST", "/api/demo/restart", { seed: `smoke-${Date.now()}` });
  let v = show("snapshot", await call("GET", "/api/worlds/mine/snapshot"));
  const legal = (v: any) => v.mission.actions.filter((a: any) => a.enabled).map((a: any) => a.key).join(", ");
  console.log("  legal:", legal(v));
  show("investigate", await call("POST", "/api/worlds/mine/mission", { action: "investigate", leadId: "coupe_velvet" }));
  for (let i = 0; i < 15; i++) {
    v = show("advance", await call("POST", "/api/demo/advance", { simSeconds: 120 }));
    if (v.mission.stage === "offer") break;
  }
  console.log("  legal:", legal(v));
  show("ask_about nico", await call("POST", "/api/worlds/mine/mission", { action: "ask_about", actorId: "nico" }));
  v = show("snapshot", await call("GET", "/api/worlds/mine/snapshot"));
  console.log("  legal:", legal(v), "| nico debts visible:", JSON.stringify(v.actors.find((a: any) => a.id === "nico").debts));
  show(`choose_driver ${driver}`, await call("POST", "/api/worlds/mine/mission", { action: "choose_driver", actorId: driver }));
  if (route !== "causeway") show(`choose_route ${route}`, await call("POST", "/api/worlds/mine/mission", { action: "choose_route", route }));
  if (precaution !== "-") show(`precaution ${precaution}`, await call("POST", "/api/worlds/mine/mission", precaution === "settle" ? { action: "settle_debt", actorId: "nico" } : { action: "precaution", id: precaution }));
  show("illegal: respond now", await call("POST", "/api/worlds/mine/mission", { action: "respond", option: "negotiate" }));
  v = show("accept", await call("POST", "/api/worlds/mine/mission", { action: "accept" }));
  for (let i = 0; i < 40 && !v.mission.outcome; i++) {
    const r = await call("POST", "/api/demo/advance", { simSeconds: 60 });
    v = r.json.view;
    if (v.mission.stage === "complication") {
      show("complication", r);
      console.log("  complication:", v.mission.complication.type, "| responses:", v.mission.actions.filter((a: any) => a.enabled).map((a: any) => `${a.key}${a.cost ? `(${a.cost})` : ""}`).join(", "));
      const pick = v.mission.actions.find((a: any) => a.enabled && a.key === (process.env.RESPONSE ?? "respond:negotiate")) ?? v.mission.actions.find((a: any) => a.enabled && a.command?.action === "respond");
      v = show(pick.key, await call("POST", "/api/worlds/mine/mission", pick.command));
    }
  }
  show("final", { status: 200, json: { view: v } });
  console.log("  outcome:", JSON.stringify(v.mission.outcome), "| leak revealed:", v.mission.leakRevealed, "| next lead:", v.mission.nextLeadId);
  const again = await call("POST", "/api/worlds/mine/mission", { action: "accept" });
  console.log("  replay accept after resolve:", again.status, again.json.error);
  const rw = await call("GET", "/api/rewards");
  console.log("  ledger:", JSON.stringify(rw.json.entries?.map((e: any) => ({ amount: e.amount, campaign: e.campaign_id, status: e.status, demo: e.demo_assisted, why: e.why?.type }))));
  const claim = rw.json.entries?.[0] && (await call("POST", `/api/rewards/${rw.json.entries[0].id}/claim`));
  console.log("  claim:", claim?.status, JSON.stringify(claim?.json));
  const snap = await call("GET", "/api/worlds/mine/snapshot");
  console.log("  feed:", snap.json.events.filter((e: any) => e.type === "post.published" || e.type === "message.sent").map((e: any) => `[${e.payload.authorId ?? e.payload.fromId}] ${e.payload.text}`).join("\n        "));
  const hidden = snap.json.events.filter((e: any) => e.visibility === "hidden");
  console.log("  hidden events leaked to client:", hidden.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
