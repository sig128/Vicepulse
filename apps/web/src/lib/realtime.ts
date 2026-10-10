import { api } from "./api.ts";
import { useStore } from "./store.ts";
import type { Me, Scenario, WorldEvent, WorldView } from "./types.ts";

let ws: WebSocket | null = null;
let retry = 0;
let pingTimer: number | undefined;
let reconnectTimer: number | undefined;
let started = false;

export async function refreshWorld(worldId: string) {
  const r = await api<{ view: WorldView; events: WorldEvent[] }>(`/api/worlds/${worldId}/snapshot`);
  const s = useStore.getState();
  s.setView(worldId, r.view);
  s.addEvents(worldId, r.events, r.view.seq);
}

export async function bootstrap() {
  if (started) return;
  started = true;
  const s = useStore.getState();
  const [me, scenario] = await Promise.all([api<Me>("/api/me"), api<Scenario>("/api/scenario")]);
  s.setMe(me);
  s.setScenario(scenario);
  await Promise.all([refreshWorld(me.sessionWorldId), refreshWorld(me.sharedWorldId)]);
  connect();
  addEventListener("online", () => { if (!ws || ws.readyState > 1) connect(); });
}

function subscribeAll() {
  const { me, lastSeq } = useStore.getState();
  if (!me || ws?.readyState !== WebSocket.OPEN) return;
  for (const id of [me.sessionWorldId, me.sharedWorldId]) ws.send(JSON.stringify({ type: "subscribe", worldId: id, lastSeq: lastSeq[id] ?? 0 }));
}

/** Called after a session restart so the socket follows the new world. */
export function resubscribe(oldWorldId?: string) {
  if (oldWorldId && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "unsubscribe", worldId: oldWorldId }));
  subscribeAll();
}

function connect() {
  clearTimeout(reconnectTimer);
  const s = useStore.getState();
  s.setConn("connecting");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConn("live");
    subscribeAll();
    clearInterval(pingTimer);
    pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 20_000);
  };
  ws.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const st = useStore.getState();
    switch (msg.type) {
      case "events": st.addEvents(msg.worldId, msg.events, msg.throughSeq); break;
      case "snapshot": st.setView(msg.worldId, msg.view); break;
      case "actors": st.patchActors(msg.worldId, msg); break;
      case "reset": st.resetWorld(msg.worldId); refreshWorld(msg.worldId).catch(() => {}); break;
    }
  };
  ws.onclose = (e) => {
    clearInterval(pingTimer);
    useStore.getState().setConn("offline");
    if (e.code === 4401) {
      // Session cookie missing or invalid: re-establish via HTTP, then retry.
      api("/api/me").then((me: Me) => useStore.getState().setMe(me)).catch(() => {});
    }
    const delay = Math.min(15_000, 500 * 2 ** retry++) + Math.random() * 400;
    reconnectTimer = window.setTimeout(connect, delay);
  };
}
