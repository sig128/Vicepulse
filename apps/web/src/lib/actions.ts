import { ApiError, post } from "./api.ts";
import { useStore } from "./store.ts";
import { refreshWorld, resubscribe } from "./realtime.ts";
import type { WorldEvent, WorldView } from "./types.ts";

type CmdResult = { ok: true; view: WorldView; events: WorldEvent[]; rewards: { created: boolean; reason?: string }[] };

function apply(r: CmdResult) {
  const s = useStore.getState();
  const id = s.me!.sessionWorldId;
  s.setView(id, r.view);
  s.addEvents(id, r.events ?? []);
  for (const rw of r.rewards ?? []) {
    if (rw.created) s.notify("Reward recorded in your app-points ledger.", "good");
    else if (rw.reason === "duplicate") s.notify("Already rewarded this session — replays are playable but not re-rewarded.");
  }
}

async function run(path: string, body: Record<string, unknown>) {
  try {
    apply(await post<CmdResult>(path, body));
    return true;
  } catch (e) {
    const s = useStore.getState();
    s.notify(e instanceof ApiError ? e.message : "Couldn't reach the server — your last confirmed state is kept.", "warn");
    if (e instanceof ApiError && e.status === 409 && s.me) refreshWorld(s.me.sessionWorldId).catch(() => {});
    return false;
  }
}

export const missionCommand = (cmd: Record<string, unknown>) => run("/api/worlds/mine/mission", cmd);
export const agentCommand = (cmd: Record<string, unknown>) => run("/api/worlds/mine/agent", cmd);

export async function demoAdvance(simSeconds: number) {
  try { apply(await post<CmdResult>("/api/demo/advance", { simSeconds })); } catch (e) { useStore.getState().notify(String((e as Error).message), "warn"); }
}

export async function demoRestart() {
  const s = useStore.getState();
  const old = s.me?.sessionWorldId;
  try {
    const r = await post<{ sessionWorldId: string }>("/api/demo/restart", {});
    s.setMe({ ...s.me!, sessionWorldId: r.sessionWorldId });
    await refreshWorld(r.sessionWorldId);
    resubscribe(old);
    s.notify("New night started. Rewards already earned stay in your ledger.");
  } catch (e) { s.notify(String((e as Error).message), "warn"); }
}
