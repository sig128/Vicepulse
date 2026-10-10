import crypto from "node:crypto";
import { RouteGraph } from "./graph.ts";
import { CAST, RULES, trustLabel } from "./cast.ts";
import { nextFloat, nextInt, pick, seedRng, type RngState } from "./rng.ts";
import type { NarrativeProvider } from "../providers/narrative.ts";
import type { MissionCommand, AgentCommand } from "@vicepulse/shared";

export type Visibility = "public" | "hidden" | `participant:${string}`;

export interface StoredEvent {
  id: string; worldId: string; sequence: number; type: string; simTime: number; createdAt: string;
  actorIds: string[]; locationId: string | null; causeEventId: string | null; visibility: Visibility;
  payload: Record<string, unknown>;
}

export interface ActorState {
  id: string; name: string; role: string;
  pos: [number, number]; nodeId: string;
  route: { nodes: string[]; seg: number; segPos: number } | null;
  holdUntil: number | null;
  /** Sent to the node it already occupies; arrival is processed on the next tick. */
  arrivePending?: boolean;
  speed: number; idleUntil: number;
  /** Public description of what the actor is visibly doing. */
  task: string;
  /** Mission-locked actors don't wander. */
  locked: boolean;
  inventory: string[];
  debts: { to: string; amount: number; resolved: boolean }[];
  memory: string[];
}

export interface Fact { id: string; key: string; text: string; holders: string[]; learnedAt: number; sourceEventId: string | null; secret: boolean }
export interface Lead { id: string; title: string; text: string; status: "open" | "taken" | "closed" | "teaser"; locationId: string | null; sourceEventId: string | null }

export type Stage = "lead" | "investigating" | "offer" | "pickup" | "delivery" | "complication" | "resolved" | "declined";
export type Outcome = "delivered" | "delivered_late" | "lost" | "abandoned" | "declined";
export type ResponseOption = "reroute" | "negotiate" | "call_contact" | "wait" | "abandon";

export interface Mission {
  id: string; stage: Stage; driverId: string | null; route: "causeway" | "south_bridge";
  precautions: string[]; askedAbout: string[];
  leak: { rolled: boolean; leaked: boolean; eventId: string | null; roll: number | null; threshold: number | null };
  complication: { type: "intercept" | "checkpoint"; node: string; startedAt: number; deadline: number; causeEventId: string | null } | null;
  responses: { option: ResponseOption; roll: number | null; threshold: number | null; success: boolean; eventId: string }[];
  outcome: Outcome | null; resolvedEventId: string | null; acceptedEventId: string | null;
  demoAssisted: boolean; nextLeadId: string | null; startedAt: number;
}

export interface WorldState {
  id: string; kind: "shared" | "session"; ownerSessionId: string | null; seed: string;
  rng: RngState; simTime: number; seq: number;
  actors: Record<string, ActorState>;
  trust: Record<string, number>;
  facts: Fact[];
  leads: Lead[];
  mission: Mission | null;
  resources: { cash: number; favors: number };
  history: { missionId: string; outcome: Outcome; driverId: string | null; leaked: boolean }[];
  checkpoint: { active: boolean; eventId: string | null; dispatched: boolean; lifted: boolean };
  lastPost: Record<string, number>;
  lastRumor?: string;
  contactCooldown: Record<string, number>;
  introduced: string[];
  revealedEventIds: string[];
  version: number;
}

export interface RewardClaim { campaignId: string; amount: number; unit: string; reason: string; eventId: string; idempotencyKey: string; demoAssisted: boolean }
export interface Changes { events: StoredEvent[]; rewards: RewardClaim[] }
export class CommandError extends Error { constructor(msg: string, readonly code = "invalid_action") { super(msg); } }

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const clock = (sim: number) => {
  const t = ((sim % 86400) + 86400) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};

export class Engine {
  constructor(readonly graph: RouteGraph, readonly narrative: NarrativeProvider, readonly places: { id: string; name: string; node: string; sourceRecordId: string | null }[]) {}

  placeAt(node: string) { return this.places.find((p) => p.node === node) ?? null; }
  placeName(node: string) { return this.placeAt(node)?.name ?? node; }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------
  async create(id: string, kind: WorldState["kind"], ownerSessionId: string | null, seed: string, now = new Date()): Promise<{ state: WorldState } & Changes> {
    const rng = seedRng(`${seed}:${id}`);
    const actors: Record<string, ActorState> = {};
    for (const c of CAST) {
      if (kind === "shared" && c.id === "wren") continue;
      const n = this.graph.node(c.home);
      actors[c.id] = {
        id: c.id, name: c.name, role: c.role, pos: [...n.game] as [number, number], nodeId: c.home, route: null, holdUntil: null,
        speed: c.speed, idleUntil: RULES.startSimTime + nextInt(rng, 10, 90), task: `At ${this.placeName(c.home)}`, locked: false,
        inventory: c.id === "wren" ? ["burner phone", "city map"] : [], debts: c.id === "nico" ? [{ to: "rourke", amount: RULES.settleDebtCost, resolved: false }] : [], memory: [],
      };
    }
    const state: WorldState = {
      id, kind, ownerSessionId, seed, rng, simTime: RULES.startSimTime, seq: 0, actors,
      trust: Object.fromEntries(CAST.map((c) => [c.id, c.initialTrust])),
      facts: [], leads: [], mission: null, resources: { cash: RULES.startCash, favors: RULES.startFavors },
      history: [], checkpoint: { active: false, eventId: null, dispatched: false, lifted: false }, lastPost: {}, contactCooldown: {}, introduced: [], revealedEventIds: [], version: 1,
    };
    // Facts that exist before the player arrives — the debt predates any choice.
    this.addFact(state, "nico_debt", "Nico owes Cass Rourke $400 from a boat job that went wrong.", ["nico", "rourke", "bo"], null, true);
    this.addFact(state, "coupe_at_velvet", "A midnight-blue custom coupe with gold rims is parked in The Velvet Room's valet lane.", ["vega", "bo", "mara"], null, false);
    const tx = this.tx(state, now);
    if (kind === "session") {
      const obs = tx.emit("world.observed", { actorIds: ["vega"], locationId: "velvet_room", payload: { what: "coupe_at_velvet", node: "velvet" } });
      const text = await this.say(state, "vega", "post", "lead.coupe", "Midnight-blue coupe, gold rims, custom plates — idling in the Velvet Room valet lane since ten. Nobody's claimed it. Somebody's waiting on something.");
      const post = tx.post("vega", text, "observed", "velvet_room", obs.id, "coupe_velvet");
      state.leads.push({ id: "coupe_velvet", title: "The coupe at The Velvet Room", text: "Vega spotted a customised coupe nobody has claimed. Find out who it belongs to.", status: "open", locationId: "velvet_room", sourceEventId: post.id });
      state.mission = this.newMission(state);
    } else {
      const obs = tx.emit("world.observed", { actorIds: ["vega"], locationId: "beach_strip", payload: { what: "city_open", node: "vice_beach" } });
      tx.post("vega", await this.say(state, "vega", "post", "shared.open", "Shared city feed is live. Neon on the strip, boats on the bay. Everything you see here is our simulation, not GTA telemetry."), "announcement", "beach_strip", obs.id, null);
    }
    return { state, ...tx.done() };
  }

  newMission(state: WorldState): Mission {
    return {
      id: `night-shift#${state.history.length + 1}`, stage: "lead", driverId: null, route: "causeway", precautions: [], askedAbout: [],
      leak: { rolled: false, leaked: false, eventId: null, roll: null, threshold: null }, complication: null, responses: [], outcome: null,
      resolvedEventId: null, acceptedEventId: null, demoAssisted: false, nextLeadId: null, startedAt: state.simTime,
    };
  }

  // -------------------------------------------------------------------------
  // Event helpers
  // -------------------------------------------------------------------------
  tx(state: WorldState, now = new Date()) {
    const events: StoredEvent[] = [];
    const rewards: RewardClaim[] = [];
    const engine = this;
    const vis = (v?: Visibility) => v ?? "public";
    type EmitOpts = { actorIds?: string[]; locationId?: string | null; causeEventId?: string | null; visibility?: Visibility; payload?: Record<string, unknown> };
    const emit = (type: string, o: EmitOpts): StoredEvent => {
      state.seq += 1;
      const ev: StoredEvent = {
        id: crypto.randomUUID(), worldId: state.id, sequence: state.seq, type, simTime: state.simTime, createdAt: now.toISOString(),
        actorIds: o.actorIds ?? [], locationId: o.locationId ?? null, causeEventId: o.causeEventId ?? null, visibility: vis(o.visibility), payload: o.payload ?? {},
      };
      events.push(ev);
      return ev;
    };
    const api = {
      events, rewards, emit,
      post(authorId: string, said: { text: string; source: string }, kind: "observed" | "rumor" | "announcement", locationId: string | null, cause: string | null, leadId: string | null) {
        state.lastPost[authorId] = state.simTime;
        return emit("post.published", { actorIds: [authorId], locationId, causeEventId: cause, payload: { authorId, text: said.text, kind, narrativeSource: said.source, leadId } });
      },
      message(fromId: string, said: { text: string; source: string }, cause: string | null) {
        if (!state.ownerSessionId) return null;
        return emit("message.sent", { actorIds: [fromId], causeEventId: cause, visibility: `participant:${state.ownerSessionId}`, payload: { fromId, toId: "player", text: said.text, narrativeSource: said.source } });
      },
      private(type: string, o: EmitOpts) {
        return emit(type, { ...o, visibility: state.ownerSessionId ? `participant:${state.ownerSessionId}` : "hidden" });
      },
      done: (): Changes => ({ events, rewards }),
    };
    void engine;
    return api;
  }

  async say(state: WorldState, actorId: string, intent: "post" | "message" | "reply", key: string, fallback: string) {
    const known = state.facts.filter((f) => f.holders.includes(actorId)).map((f) => f.text);
    const r = await this.narrative.line({ key: `${key}:${actorId}`, actorId, actorName: state.actors[actorId]?.name ?? actorId, intent, knownFacts: known, fallback });
    return { text: r.text, source: r.source };
  }

  addFact(state: WorldState, key: string, text: string, holders: string[], sourceEventId: string | null, secret: boolean) {
    const existing = state.facts.find((f) => f.key === key);
    if (existing) { for (const h of holders) if (!existing.holders.includes(h)) existing.holders.push(h); return existing; }
    const f: Fact = { id: `fact:${key}`, key, text, holders: [...holders], learnedAt: state.simTime, sourceEventId, secret };
    state.facts.push(f);
    for (const h of holders) state.actors[h]?.memory.push(text);
    return f;
  }

  playerKnows(state: WorldState, key: string) {
    return !!state.facts.find((f) => f.key === key && (f.holders.includes("wren") || f.holders.includes("player")));
  }

  teach(state: WorldState, key: string, holder: string, sourceEventId: string | null) {
    const f = state.facts.find((x) => x.key === key);
    if (!f || f.holders.includes(holder)) return;
    f.holders.push(holder);
    state.actors[holder]?.memory.push(f.text);
    if (holder === "wren" && !f.holders.includes("player")) f.holders.push("player");
    void sourceEventId;
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------
  sendTo(a: ActorState, target: string, task: string, avoid: Set<string> = new Set()) {
    const path = this.graph.shortestPath(a.nodeId, target, avoid);
    if (!path) throw new CommandError(`No authored route from ${a.nodeId} to ${target}`);
    this.follow(a, path, task);
    return path;
  }

  follow(a: ActorState, path: string[], task: string) {
    if (!this.graph.isValidPath(path)) throw new Error(`Invalid path ${path.join(">")}`);
    if (path[0] !== a.nodeId) throw new Error(`Path must start at ${a.nodeId}`);
    a.route = path.length > 1 ? { nodes: path, seg: 0, segPos: 0 } : null;
    a.arrivePending = path.length === 1;
    a.pos = [...this.graph.node(a.nodeId).game] as [number, number];
    a.task = task;
  }

  /** Advance along the route; `onArrive` may return "halt" to stop at that node. */
  advance(a: ActorState, dt: number, onArrive: (node: string, final: boolean) => "continue" | "halt") {
    if (!a.route) return;
    if (a.holdUntil != null) return;
    let remaining = a.speed * dt;
    while (a.route && remaining > 1e-9) {
      const from = this.graph.node(a.route.nodes[a.route.seg]).game;
      const to = this.graph.node(a.route.nodes[a.route.seg + 1]).game;
      const len = dist(from, to);
      const left = len - a.route.segPos;
      if (remaining >= left) {
        remaining -= left;
        a.route.seg += 1;
        a.route.segPos = 0;
        a.nodeId = a.route.nodes[a.route.seg];
        a.pos = [...to] as [number, number];
        const final = a.route.seg >= a.route.nodes.length - 1;
        if (final) a.route = null;
        if (onArrive(a.nodeId, final) === "halt") { a.route = null; return; }
        if (a.holdUntil != null) return;
      } else {
        a.route.segPos += remaining;
        remaining = 0;
        const t = a.route.segPos / len;
        a.pos = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  async tick(state: WorldState, dtSim: number, now = new Date()): Promise<Changes> {
    const tx = this.tx(state, now);
    state.simTime += dtSim;
    const m = state.mission;

    // Patrol schedule (public, deterministic, exists before any mission choice).
    const dade = state.actors.dade;
    if (dade && !state.checkpoint.dispatched && state.simTime >= RULES.checkpoint.setAt - 240) {
      state.checkpoint.dispatched = true;
      dade.locked = true;
      this.sendTo(dade, RULES.checkpoint.node, "Driving to the causeway approach");
    }
    if (dade && state.checkpoint.active && !state.checkpoint.lifted && state.simTime >= RULES.checkpoint.liftAt) {
      state.checkpoint.active = false;
      state.checkpoint.lifted = true;
      dade.locked = false;
      dade.task = "Patrol";
      const ev = tx.emit("patrol.checkpoint_lifted", { actorIds: ["dade"], locationId: "causeway", causeEventId: state.checkpoint.eventId });
      tx.post("priya", await this.say(state, "priya", "post", "priya.lifted", "Scanner says the causeway checkpoint just packed up. Roads are open, night owls."), "rumor", "causeway", ev.id, null);
    }

    // Holds expire
    for (const a of Object.values(state.actors)) {
      if (a.holdUntil != null && state.simTime >= a.holdUntil) a.holdUntil = null;
    }

    // Complication countdown
    if (m && m.stage === "complication" && m.complication && state.simTime >= m.complication.deadline) {
      if (m.complication.type === "intercept") {
        const ev = tx.private("mission.countdown_expired", { actorIds: [m.driverId!], locationId: null, causeEventId: m.complication.causeEventId, payload: { complication: "intercept", effect: "Tidewater took the car" } });
        await this.resolve(state, tx, "lost", ev.id);
      } else {
        await this.respondInternal(state, tx, "wait", true);
      }
    }

    const arrivals: { actor: ActorState; node: string; final: boolean }[] = [];
    for (const a of Object.values(state.actors)) {
      if (a.arrivePending && a.holdUntil == null) {
        a.arrivePending = false;
        arrivals.push({ actor: a, node: a.nodeId, final: true });
        continue;
      }
      this.advance(a, dtSim, (node, final) => {
        arrivals.push({ actor: a, node, final });
        if (m && a.id === m.driverId && m.stage === "delivery" && node === RULES.approachNode[m.route]) {
          return this.checkComplication(state, tx, a) ? "halt" : "continue";
        }
        return "continue";
      });
    }
    for (const { actor, node, final } of arrivals) await this.onArrive(state, tx, actor, node, final);

    // Ambient wandering
    for (const a of Object.values(state.actors)) {
      const c = CAST.find((x) => x.id === a.id)!;
      if (a.locked || a.route || a.holdUntil != null || !c.haunts.length || state.simTime < a.idleUntil) continue;
      const options = c.haunts.filter((h) => h !== a.nodeId);
      const target = pick(state.rng, options);
      this.sendTo(a, target, `Heading to ${this.placeName(target)}`);
      a.idleUntil = Infinity;
    }

    // Radio rumour cadence, grounded in actual state
    const tidewaterOut = !!state.actors.tamsin && state.actors.tamsin.nodeId !== "watson";
    const rumorKey = `${state.checkpoint.active}.${tidewaterOut}`;
    const sincePriya = state.simTime - (state.lastPost.priya ?? RULES.startSimTime);
    if (state.actors.priya && sincePriya >= 600 && (rumorKey !== state.lastRumor || sincePriya >= 1800)) {
      state.lastRumor = rumorKey;
      const fallback = state.checkpoint.active
        ? "Callers keep asking about the causeway. Yes, the blue lights are still there. Take the long way or bring patience."
        : tidewaterOut
          ? "Someone on the line says Tidewater boats are quiet tonight but their cars aren't. Make of that what you will."
          : "Quiet scanner, warm night. Request lines are open.";
      const obs = tx.emit("world.observed", { actorIds: ["priya"], locationId: null, payload: { what: "scanner", checkpoint: state.checkpoint.active } });
      tx.post("priya", await this.say(state, "priya", "post", `priya.rumor.${state.checkpoint.active}.${tidewaterOut}`, fallback), "rumor", null, obs.id, null);
    }

    return tx.done();
  }

  async onArrive(state: WorldState, tx: ReturnType<Engine["tx"]>, a: ActorState, node: string, final: boolean) {
    const m = state.mission;
    if (final) {
      a.task = `At ${this.placeName(node)}`;
      if (!a.locked) a.idleUntil = state.simTime + nextInt(state.rng, 120, 360);
    }
    // Patrol sets up
    if (a.id === "dade" && final && node === RULES.checkpoint.node && !state.checkpoint.active && !state.checkpoint.lifted) {
      state.checkpoint.active = true;
      a.task = "Running a checkpoint";
      const ev = tx.emit("patrol.checkpoint_set", { actorIds: ["dade"], locationId: "causeway", payload: { node, until: clock(RULES.checkpoint.liftAt) } });
      state.checkpoint.eventId = ev.id;
      tx.post("priya", await this.say(state, "priya", "post", "priya.checkpoint", `Scanner chatter: VCPD just set up on the causeway approach. Word is they're there until ${clock(RULES.checkpoint.liftAt)}.`), "rumor", "causeway", ev.id, null);
    }
    // Vega posts what she actually sees, at most every 6 sim minutes
    if (a.id === "vega" && final && state.simTime - (state.lastPost.vega ?? 0) >= 360) {
      const coupeHere = node === "velvet" && (!m || ["lead", "investigating", "offer"].includes(m.stage));
      const lines: Record<string, string> = {
        velvet: coupeHere ? "That blue coupe is still sitting in the Velvet lane. Valet keeps glancing at the street." : "Velvet Room's loud tonight. Valet lane's empty now.",
        vice_beach: "Ocean Beach strip doing its thing — pink neon, chrome, and somebody's subwoofer.",
        bayside: state.actors.jules?.nodeId === "bayside" ? "Same runner on the Bayside Walk every night. Doesn't look at anyone." : "Bayside Walk is all fishermen and fog.",
        catalan_s: "Catalan Blvd glowing like a pinball machine.",
        catalan_n: state.checkpoint.active ? "From up here you can see the blue lights on the causeway approach. Long line." : "Catalan north, wide open. Causeway looks clear.",
      };
      const text = lines[node];
      if (text) {
        const place = this.placeAt(node);
        const obs = tx.emit("world.observed", { actorIds: ["vega"], locationId: place?.id ?? null, payload: { node } });
        tx.post("vega", await this.say(state, "vega", "post", `vega.${node}.${coupeHere}.${state.checkpoint.active}`, text), "observed", place?.id ?? null, obs.id, null);
      }
    }
    if (!m) return;

    // Agent investigation
    if (a.id === "wren" && m.stage === "investigating" && final && node === "velvet") {
      const obs = tx.private("agent.observed", { actorIds: ["wren"], locationId: "velvet_room", payload: { what: "coupe_at_velvet" } });
      this.teach(state, "coupe_at_velvet", "wren", obs.id);
      state.introduced.push("mara", "bo", "dorian");
      const intro = tx.private("contact.introduced", { actorIds: ["mara", "wren"], locationId: "quint_autobody", causeEventId: obs.id, payload: { contactId: "mara" } });
      tx.message("mara", await this.say(state, "mara", "message", "mara.offer",
        `Heard your agent is asking about my coupe. It belongs to a client. Dorian Salt pays $900 when it reaches Berth 14 intact. I need a driver: Nico is $${RULES.fees.nico}, Jules is $${RULES.fees.jules}. Bo at the bar knows both of them.`), intro.id);
      m.stage = "offer";
      state.leads.find((l) => l.id === "coupe_velvet")!.status = "taken";
      tx.private("mission.offered", { actorIds: ["mara"], locationId: "velvet_room", causeEventId: intro.id, payload: {
        missionId: m.id, title: "The Night Shift", objective: "Move the coupe from The Velvet Room to Berth 14 for Dorian Salt.",
        reward: { amount: RULES.reward.amount, unit: RULES.reward.unit, conditions: "Coupe reaches Berth 14 intact. First successful completion per guest session." },
        payout: { cash: 900, late: 600 },
      } });
    }

    // Driver pickup
    if (m.driverId === a.id && m.stage === "pickup" && final && node === "velvet") {
      a.inventory.push("coupe keys");
      const ev = tx.private("mission.pickup", { actorIds: [a.id], locationId: "velvet_room", causeEventId: m.acceptedEventId, payload: { route: m.route } });
      if (a.id === "nico" && m.precautions.includes("sealed_route")) this.rollLeak(state, tx, ev.id, "pickup");
      m.stage = "delivery";
      this.follow(a, RULES.routes[m.route], `Driving the coupe toward Berth 14`);
      if (state.actors.vega?.nodeId === "velvet" && !state.actors.vega.route) {
        const obs = tx.emit("world.observed", { actorIds: ["vega"], locationId: "velvet_room", causeEventId: ev.id, payload: { what: "coupe_left" } });
        tx.post("vega", await this.say(state, "vega", "post", "vega.coupe_left", "And there goes the blue coupe out of the Velvet lane. Somebody finally claimed it."), "observed", "velvet_room", obs.id, null);
      }
    }

    // Delivery
    if (m.driverId === a.id && m.stage === "delivery" && final && node === "port_berth") {
      const late = state.simTime > RULES.deliveryDeadline;
      const ev = tx.private("mission.delivered", { actorIds: [a.id, "dorian"], locationId: "berth_14", causeEventId: m.responses.at(-1)?.eventId ?? m.acceptedEventId, payload: { late, at: clock(state.simTime) } });
      await this.resolve(state, tx, late ? "delivered_late" : "delivered", ev.id);
    }

    // Rival staging
    if (a.id === "tamsin" && final && m.leak.leaked && m.stage !== "resolved") {
      a.task = "Waiting by the road";
    }
  }

  rollLeak(state: WorldState, tx: ReturnType<Engine["tx"]>, causeId: string, when: "accept" | "pickup") {
    const m = state.mission!;
    if (m.leak.rolled) return;
    const nico = state.actors.nico;
    const settled = nico.debts.every((d) => d.resolved);
    const threshold = settled ? RULES.leakThreshold.debtSettled : m.precautions.includes("sealed_route") ? RULES.leakThreshold.sealedRoute : RULES.leakThreshold.base;
    const roll = nextFloat(state.rng);
    m.leak = { rolled: true, leaked: roll < threshold, eventId: null, roll, threshold };
    if (!m.leak.leaked) return;
    // Hidden from every viewer until the mission resolves.
    const leak = tx.emit("driver.leaked_route", { actorIds: ["nico", "rourke"], visibility: "hidden", causeEventId: causeId, payload: { route: m.route, when, roll, threshold, rule: "leak if roll < threshold; threshold 0.85 base, 0.35 sealed route, 0 debt settled" } });
    m.leak.eventId = leak.id;
    this.addFact(state, "route_plan", `The coupe goes ${m.route === "causeway" ? "over the causeway and through the port tunnel" : "south over the port bridge"} tonight.`, ["nico", "rourke", "tamsin"], leak.id, true);
    const tamsin = state.actors.tamsin;
    tamsin.locked = true;
    tamsin.holdUntil = null;
    this.sendTo(tamsin, RULES.approachNode[m.route], "Driving somewhere in a hurry");
    tx.emit("rival.dispatched", { actorIds: ["rourke", "tamsin"], visibility: "hidden", causeEventId: leak.id, payload: { to: RULES.approachNode[m.route] } });
  }

  checkComplication(state: WorldState, tx: ReturnType<Engine["tx"]>, driver: ActorState): boolean {
    const m = state.mission!;
    const approach = RULES.approachNode[m.route];
    const tamsin = state.actors.tamsin;
    if (m.leak.leaked && tamsin.nodeId === approach && !tamsin.route && !m.responses.length) {
      const ev = tx.private("mission.complication", { actorIds: [driver.id, "tamsin"], locationId: null, causeEventId: m.leak.eventId, payload: {
        type: "intercept", node: approach,
        text: `Two Tidewater cars are blocking the road at ${this.placeName(approach)}. ${driver.id === "nico" ? "Nico has gone very quiet." : ""}`.trim(),
      } });
      m.complication = { type: "intercept", node: approach, startedAt: state.simTime, deadline: state.simTime + RULES.complicationWindowSim, causeEventId: ev.id };
      m.stage = "complication";
      driver.task = "Stopped — road blocked";
      return true;
    }
    if (m.route === "causeway" && state.checkpoint.active && !m.responses.length) {
      const ev = tx.private("mission.complication", { actorIds: [driver.id, "dade"], locationId: "causeway", causeEventId: state.checkpoint.eventId, payload: {
        type: "checkpoint", node: approach, text: "VCPD checkpoint ahead on the causeway approach. A coupe with no paperwork is a long conversation.",
      } });
      m.complication = { type: "checkpoint", node: approach, startedAt: state.simTime, deadline: state.simTime + RULES.complicationWindowSim, causeEventId: ev.id };
      m.stage = "complication";
      driver.task = "Idling before the checkpoint";
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Player commands (authorisation is done by the caller: only the session owner reaches here)
  // -------------------------------------------------------------------------
  async mission(state: WorldState, cmd: MissionCommand | { action: "precaution"; id: string } | { action: "choose_route"; route: string }, now = new Date()): Promise<Changes> {
    const m = state.mission;
    if (state.kind !== "session" || !m) throw new CommandError("No playable mission in this world", "no_mission");
    const legal = this.legal(state).find((l) => l.key === keyOf(cmd));
    if (!legal) throw new CommandError("Unknown action for the current stage");
    if (!legal.enabled) throw new CommandError(legal.reason ?? "Not available right now");
    const tx = this.tx(state, now);

    switch (cmd.action) {
      case "investigate": {
        const wren = state.actors.wren;
        this.sendTo(wren, "velvet", "Investigating the coupe at The Velvet Room");
        m.stage = "investigating";
        tx.private("agent.dispatched", { actorIds: ["wren"], locationId: "velvet_room", causeEventId: state.leads.find((l) => l.id === "coupe_velvet")?.sourceEventId ?? null, payload: { command: "investigate", to: "velvet" } });
        break;
      }
      case "ask_about": {
        m.askedAbout.push(cmd.actorId);
        const ev = tx.private("agent.asked", { actorIds: ["wren", "bo"], locationId: "velvet_room", payload: { about: cmd.actorId } });
        if (cmd.actorId === "nico") {
          const debt = state.actors.nico.debts.find((d) => !d.resolved);
          this.teach(state, "nico_debt", "wren", ev.id);
          tx.message("bo", await this.say(state, "bo", "reply", `bo.nico.${!!debt}`, debt
            ? "Nico? Sweet kid. Owes Cass Rourke four hundred since that boat thing went sideways. Rourke's people have been in here asking where he drinks."
            : "Nico squared his business with Rourke tonight. Walked out of here lighter."), ev.id);
        } else {
          tx.message("bo", await this.say(state, "bo", "reply", "bo.jules", "Jules only talks to Mara. Never late, never cheap, never in the papers."), ev.id);
        }
        break;
      }
      case "settle_debt": {
        state.resources.cash -= RULES.settleDebtCost;
        state.actors.nico.debts.forEach((d) => (d.resolved = true));
        const ev = tx.private("debt.settled", { actorIds: ["nico", "rourke", "mara"], payload: { amount: RULES.settleDebtCost } });
        this.addFact(state, "nico_debt_settled", "Mara paid Rourke on Nico's behalf; the debt is closed.", ["nico", "rourke", "mara", "wren", "player"], ev.id, false);
        tx.message("mara", await this.say(state, "mara", "message", "mara.settled", "Done. Rourke has his four hundred and Nico's name is clean. Don't make me regret it."), ev.id);
        break;
      }
      case "precaution": {
        state.resources.favors -= RULES.sealedRouteFavorCost;
        m.precautions.push("sealed_route");
        const ev = tx.private("mission.precaution", { actorIds: ["mara"], payload: { id: "sealed_route", cost: { favors: 1 } } });
        tx.message("mara", await this.say(state, "mara", "message", "mara.sealed", "Fine. The driver gets the route from me at the curb, not a minute before."), ev.id);
        break;
      }
      case "choose_route": {
        m.route = cmd.route as Mission["route"];
        tx.private("mission.route_chosen", { actorIds: [], payload: { route: m.route, nodes: RULES.routes[m.route] } });
        break;
      }
      case "choose_driver": {
        m.driverId = cmd.actorId;
        tx.private("mission.driver_chosen", { actorIds: [cmd.actorId], payload: { driverId: cmd.actorId, fee: RULES.fees[cmd.actorId] } });
        break;
      }
      case "accept": {
        const driver = state.actors[m.driverId!];
        state.resources.cash -= RULES.fees[driver.id];
        driver.locked = true;
        const ev = tx.private("mission.accepted", { actorIds: [driver.id, "mara"], locationId: "velvet_room", payload: { driverId: driver.id, route: m.route, fee: RULES.fees[driver.id], precautions: m.precautions } });
        m.acceptedEventId = ev.id;
        m.stage = "pickup";
        state.introduced.push("ines");
        this.addFact(state, "route_plan_player", `Your plan: ${driver.name}, ${m.route === "causeway" ? "causeway and port tunnel" : "south port bridge"}.`, ["wren", "player", "mara", ...(m.precautions.includes("sealed_route") ? [] : [driver.id])], ev.id, false);
        this.sendTo(driver, "velvet", "Heading to The Velvet Room for a pickup");
        tx.message("mara", await this.say(state, "mara", "message", `mara.accepted.${driver.id}`, `${driver.name} is on the way to the Velvet. If it goes sideways, Ines at Salton River Yard owes me — one call, one favour.`), ev.id);
        if (driver.id === "nico" && !m.precautions.includes("sealed_route")) this.rollLeak(state, tx, ev.id, "accept");
        break;
      }
      case "decline": {
        const ev = tx.private("mission.declined", { actorIds: ["mara"], payload: {} });
        await this.resolve(state, tx, "declined", ev.id);
        break;
      }
      case "respond": {
        await this.respondInternal(state, tx, cmd.option, false);
        break;
      }
    }
    return tx.done();
  }

  async respondInternal(state: WorldState, tx: ReturnType<Engine["tx"]>, option: ResponseOption, automatic: boolean) {
    const m = state.mission!;
    const c = m.complication!;
    const driver = state.actors[m.driverId!];
    const key = `${option}_${c.type}` as keyof typeof RULES.success;
    const threshold = option === "abandon" ? null : (RULES.success[key] ?? 1);
    const roll = threshold != null && threshold < 1 ? nextFloat(state.rng) : null;
    const success = option !== "abandon" && (roll == null || roll < threshold!);
    if (option === "negotiate") state.resources.cash -= RULES.negotiateCost;
    if (option === "call_contact") state.resources.favors -= 1;
    const ev = tx.private("mission.response", { actorIds: [driver.id], causeEventId: c.causeEventId, payload: { option, automatic, roll, threshold, success, complication: c.type } });
    m.responses.push({ option, roll, threshold, success, eventId: ev.id });
    if (option === "abandon") { await this.resolve(state, tx, "abandoned", ev.id); return; }
    if (!success) { await this.resolve(state, tx, "lost", ev.id); return; }

    m.complication = null;
    m.stage = "delivery";
    const releaseTamsin = () => { const t = state.actors.tamsin; t.locked = false; t.idleUntil = state.simTime + 60; this.sendTo(t, "watson", "Heading back to Tidewater Slip"); };
    if (option === "reroute") {
      const alt = m.route === "causeway" ? "south_bridge" : "causeway";
      const avoid = new Set(RULES.routes[m.route].slice(RULES.routes[m.route].indexOf(c.node) + 1, -1));
      this.sendTo(driver, "port_berth", `Rerouting via the ${alt === "causeway" ? "causeway" : "port bridge"}`, avoid);
      m.route = alt;
    } else {
      if (option === "wait") driver.holdUntil = state.simTime + RULES.waitDelaySim;
      if (c.type === "intercept") releaseTamsin();
      const rest = RULES.routes[m.route].slice(RULES.routes[m.route].indexOf(c.node));
      this.follow(driver, rest, option === "wait" ? "Waiting out the checkpoint" : "Back on the road to Berth 14");
    }
    if (option === "call_contact") {
      const who = c.type === "checkpoint" ? "mara" : "ines";
      tx.message(who, await this.say(state, who, "message", `${who}.called.${c.type}`, who === "mara"
        ? "I made a call. Officer Dade is about to wave a blue coupe through. You owe me."
        : "Tow truck's across the Tidewater cars' bumpers. Tell your driver to go. Now."), ev.id);
    }
    if (option === "negotiate") {
      tx.message("mara", await this.say(state, "mara", "message", "mara.negotiated", "Rourke took the five hundred. Expensive lesson, but the car's moving."), ev.id);
      state.trust.rourke += 1;
    }
  }

  async resolve(state: WorldState, tx: ReturnType<Engine["tx"]>, outcome: Outcome, causeId: string) {
    const m = state.mission!;
    if (m.stage === "resolved" || m.stage === "declined") return;
    const driver = m.driverId ? state.actors[m.driverId] : null;
    m.outcome = outcome;
    m.stage = outcome === "declined" ? "declined" : "resolved";
    m.complication = null;
    const success = outcome === "delivered" || outcome === "delivered_late";
    const delta: Record<string, number> = {};
    const bump = (id: string, d: number) => { state.trust[id] = Math.max(-3, Math.min(3, (state.trust[id] ?? 0) + d)); delta[id] = (delta[id] ?? 0) + d; };
    if (outcome === "delivered") { bump("mara", 2); bump("dorian", 1); if (driver) bump(driver.id, 1); state.resources.cash += 900; }
    if (outcome === "delivered_late") { bump("mara", 1); if (driver) bump(driver.id, 1); state.resources.cash += 600; }
    if (outcome === "lost") { bump("mara", -2); bump("dorian", -1); }
    if (outcome === "abandoned" || outcome === "declined") bump("mara", -1);
    if (m.leak.leaked) bump("nico", -3);

    const resolved = tx.private("mission.resolved", { actorIds: [driver?.id, "mara"].filter(Boolean) as string[], locationId: success ? "berth_14" : null, causeEventId: causeId, payload: {
      outcome, trustDelta: delta, cash: state.resources.cash, leaked: m.leak.leaked, rewardEligible: success,
    } });
    m.resolvedEventId = resolved.id;

    if (m.leak.leaked && m.leak.eventId) {
      state.revealedEventIds.push(m.leak.eventId);
      const rev = tx.private("fact.revealed", { actorIds: ["nico", "rourke"], causeEventId: m.leak.eventId, payload: { factKey: "route_plan", text: "Nico sold your route to Cass Rourke to clear his debt. Tidewater knew where to wait." } });
      this.teach(state, "route_plan", "wren", rev.id);
      this.addFact(state, "nico_sold_route", "Nico sold the route to Rourke.", ["wren", "player", "mara"], rev.id, false);
    }

    // Next lead depends on what actually happened
    const leadFor = (): Lead => {
      if (outcome === "lost") return { id: "tidewater_slip", title: "Get the coupe back", text: "Tidewater has the coupe at their slip. Mara wants it back before Dorian hears.", status: "teaser", locationId: "tidewater_dock", sourceEventId: resolved.id };
      if (outcome === "abandoned" || outcome === "declined") return { id: "mara_cold", title: "Mara isn't calling", text: "Mara has gone quiet. Vega says the Velvet Room crowd has other work for whoever is around.", status: "teaser", locationId: "velvet_room", sourceEventId: resolved.id };
      if (m.leak.leaked) return { id: "who_paid_nico", title: "Who else did Nico talk to?", text: "The car made it, but Nico sold the route. Mara wants to know what else Rourke bought.", status: "teaser", locationId: "cafe_marti", sourceEventId: resolved.id };
      if (driver?.id === "jules") return { id: "dorian_regular", title: "Dorian wants a regular", text: "Dorian liked how quiet that was. He'll offer your crew the next car directly, at better terms.", status: "teaser", locationId: "berth_14", sourceEventId: resolved.id };
      return { id: "nico_owes_you", title: "Nico owes you one", text: "Nico's debt is closed and the car arrived. He says he knows who has been watching Tidewater's boats.", status: "teaser", locationId: "cafe_marti", sourceEventId: resolved.id };
    };
    const lead = leadFor();
    state.leads.push(lead);
    m.nextLeadId = lead.id;

    const msg: Record<Outcome, string> = {
      delivered: "Dorian's happy. The car's in Berth 14 and nobody saw a thing. I'll remember this.",
      delivered_late: "It arrived. Late. Dorian docked the fee, but it arrived.",
      lost: "Tidewater has my client's car. Do you understand what that means for me?",
      abandoned: "You walked away from my car. Noted.",
      declined: "Your loss. I'll find someone else.",
    };
    tx.message("mara", await this.say(state, "mara", "message", `mara.resolved.${outcome}.${m.leak.leaked}`, msg[outcome]), resolved.id);

    const vegaLines: Record<Outcome, string> = {
      delivered: "Port's quiet. Saw a blue coupe roll into Berth 14 like it owned the place.",
      delivered_late: "Blue coupe finally crawled into the port after the causeway mess. Somebody's having a long night.",
      lost: "Heard tyres and shouting by the water. Tidewater crew towing something shiny toward the slip.",
      abandoned: "Blue coupe left with its hazards on near the bridge. Driver nowhere.",
      declined: "Still nobody's claimed that blue coupe at the Velvet. Valet's getting nervous.",
    };
    const obs = tx.emit("world.observed", { actorIds: ["vega"], locationId: success ? "berth_14" : null, causeEventId: resolved.id, payload: { what: `outcome:${outcome}` } });
    tx.post("vega", await this.say(state, "vega", "post", `vega.outcome.${outcome}`, vegaLines[outcome]), outcome === "lost" || outcome === "abandoned" ? "rumor" : "observed", success ? "berth_14" : null, obs.id, lead.id);

    state.history.push({ missionId: m.id, outcome, driverId: m.driverId, leaked: m.leak.leaked });
    if (driver) { driver.locked = false; driver.inventory = driver.inventory.filter((i) => i !== "coupe keys"); driver.idleUntil = state.simTime + 120; driver.task = success ? "Paid and heading home" : "Laying low"; }
    const tamsin = state.actors.tamsin;
    if (tamsin.locked) { tamsin.locked = false; tamsin.idleUntil = state.simTime + 90; }

    if (success && state.ownerSessionId) {
      tx.rewards.push({
        campaignId: RULES.reward.campaignId, amount: RULES.reward.amount, unit: RULES.reward.unit,
        reason: `The Night Shift: coupe delivered${outcome === "delivered_late" ? " (late)" : ""}`, eventId: resolved.id,
        // One entitlement per guest session per campaign — replays, refreshes and duplicate events map to the same key.
        idempotencyKey: `${RULES.reward.campaignId}:${state.ownerSessionId}`, demoAssisted: m.demoAssisted,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Agent commands map onto the same legal-action table
  // -------------------------------------------------------------------------
  async agent(state: WorldState, cmd: AgentCommand, now = new Date()): Promise<Changes> {
    if (state.kind !== "session") throw new CommandError("Your agent only acts in your session", "no_agent");
    const legal = this.agentLegal(state).find((l) => l.command === cmd.command && (cmd.command !== "contact" || l.target === cmd.actorId) && (cmd.command !== "travel" || l.target === cmd.nodeId || l.target === "*"));
    if (!legal) throw new CommandError("Unknown agent command");
    if (!legal.enabled) throw new CommandError(legal.reason ?? "Not available");
    if (cmd.command === "investigate") return this.mission(state, { action: "investigate", leadId: "coupe_velvet" }, now);
    if (cmd.command === "wait" && state.mission?.stage === "complication") return this.mission(state, { action: "respond", option: "wait" }, now);
    const tx = this.tx(state, now);
    const wren = state.actors.wren;
    if (cmd.command === "travel") {
      if (!this.graph.nodes.has(cmd.nodeId)) throw new CommandError("Unknown destination");
      this.sendTo(wren, cmd.nodeId, `Travelling to ${this.placeName(cmd.nodeId)}`);
      tx.private("agent.travel", { actorIds: ["wren"], payload: { to: cmd.nodeId } });
    } else if (cmd.command === "return") {
      this.sendTo(wren, "safehouse", "Returning to the Crosstown Lot");
      tx.private("agent.travel", { actorIds: ["wren"], payload: { to: "safehouse" } });
    } else if (cmd.command === "wait") {
      wren.route = null;
      wren.task = "Holding position";
      tx.private("agent.waiting", { actorIds: ["wren"], payload: {} });
    } else if (cmd.command === "contact") {
      state.contactCooldown[cmd.actorId] = state.simTime;
      const ev = tx.private("agent.contacted", { actorIds: ["wren", cmd.actorId], payload: { actorId: cmd.actorId } });
      const m = state.mission;
      const replies: Record<string, string> = {
        mara: !m || m.stage === "resolved" ? "We're square for tonight." : m.stage === "offer" ? `Pick a driver. Nico's cheap, Jules is careful. Clock's running.` : m.stage === "complication" ? "I heard. Decide fast — I can make one call if you've got the favour." : "Keep your phone on.",
        ines: (state.resources.favors > 0) ? "Need a roadblock or a tow, call me during the job. It costs Mara's favour." : "No favours left on Mara's tab, sweetheart.",
        dorian: "Berth 14. Intact. On time. That's all I want to hear.",
        bo: "Ask me about someone specific and I'll tell you what the bar knows.",
      };
      tx.message(cmd.actorId, await this.say(state, cmd.actorId, "reply", `contact.${cmd.actorId}.${m?.stage}`, replies[cmd.actorId] ?? "..."), ev.id);
    }
    return tx.done();
  }

  /** Demo-only: advance simulation time quickly. Marks the current mission as demo-assisted. */
  async advance_time(state: WorldState, simSeconds: number, now = new Date()): Promise<Changes> {
    if (state.mission && state.mission.stage !== "resolved") state.mission.demoAssisted = true;
    const all: Changes = { events: [], rewards: [] };
    const steps = Math.ceil(simSeconds / RULES.simRate);
    for (let i = 0; i < steps; i++) {
      const c = await this.tick(state, RULES.simRate, now);
      all.events.push(...c.events); all.rewards.push(...c.rewards);
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Legal actions (single source of truth for enabled/disabled + reasons)
  // -------------------------------------------------------------------------
  legal(state: WorldState) {
    const m = state.mission;
    const out: { key: string; label: string; enabled: boolean; reason?: string; cost?: string; command: Record<string, unknown> }[] = [];
    if (!m) return out;
    const wren = state.actors.wren;
    const atVelvet = wren?.nodeId === "velvet" && !wren.route;
    const cash = state.resources.cash, favors = state.resources.favors;
    if (m.stage === "lead") out.push({ key: "investigate", label: "Investigate the coupe", enabled: true, command: { action: "investigate", leadId: "coupe_velvet" } });
    if (m.stage === "offer") {
      for (const id of ["nico", "jules"]) {
        const asked = m.askedAbout.includes(id);
        out.push({ key: `ask_about:${id}`, label: `Ask Bo about ${state.actors[id].name}`, enabled: atVelvet && !asked, reason: asked ? "Already asked" : !atVelvet ? "Bo is at The Velvet Room; your agent must be there" : undefined, command: { action: "ask_about", actorId: id } });
      }
      const knowsDebt = this.playerKnows(state, "nico_debt");
      const debtOpen = state.actors.nico.debts.some((d) => !d.resolved);
      if (knowsDebt) out.push({ key: "settle_debt:nico", label: "Have Mara settle Nico's debt", cost: `$${RULES.settleDebtCost}`, enabled: debtOpen && cash >= RULES.settleDebtCost, reason: !debtOpen ? "Debt already settled" : cash < RULES.settleDebtCost ? "Not enough cash" : undefined, command: { action: "settle_debt", actorId: "nico" } });
      out.push({ key: "precaution:sealed_route", label: "Seal the route until pickup", cost: "1 favour", enabled: favors >= 1 && !m.precautions.includes("sealed_route"), reason: m.precautions.includes("sealed_route") ? "Already sealed" : favors < 1 ? "No favours left" : undefined, command: { action: "precaution", id: "sealed_route" } });
      for (const r of ["causeway", "south_bridge"]) out.push({ key: `choose_route:${r}`, label: r === "causeway" ? "Route: causeway + port tunnel (fast)" : "Route: south port bridge (slower)", enabled: m.route !== r, reason: m.route === r ? "Selected" : undefined, command: { action: "choose_route", route: r } });
      for (const id of ["nico", "jules"]) out.push({ key: `choose_driver:${id}`, label: `Choose ${state.actors[id].name}`, cost: `$${RULES.fees[id]}`, enabled: m.driverId !== id, reason: m.driverId === id ? "Selected" : undefined, command: { action: "choose_driver", actorId: id } });
      const fee = m.driverId ? RULES.fees[m.driverId] : 0;
      out.push({ key: "accept", label: "Accept the contract", enabled: !!m.driverId && cash >= fee, reason: !m.driverId ? "Choose a driver first" : cash < fee ? "Not enough cash for the driver's fee" : undefined, command: { action: "accept" } });
      out.push({ key: "decline", label: "Decline", enabled: true, command: { action: "decline" } });
    }
    if (m.stage === "complication" && m.complication) {
      const c = m.complication;
      const opt = (o: ResponseOption, label: string, enabled: boolean, reason?: string, cost?: string) => out.push({ key: `respond:${o}`, label, enabled, reason, cost, command: { action: "respond", option: o } });
      const pct = (k: keyof typeof RULES.success) => `${Math.round(RULES.success[k] * 100)}%`;
      if (c.type === "intercept") {
        opt("reroute", `Reroute via ${m.route === "causeway" ? "the port bridge" : "the causeway"} (${pct("reroute_intercept")} chance)`, true, undefined, "time");
        opt("negotiate", "Pay Rourke to let it through (certain)", cash >= RULES.negotiateCost, cash < RULES.negotiateCost ? "Not enough cash" : undefined, `$${RULES.negotiateCost}`);
        opt("call_contact", `Call Ines for a roadblock (${pct("call_contact_intercept")} chance)`, favors >= 1 && state.introduced.includes("ines"), favors < 1 ? "No favours left" : !state.introduced.includes("ines") ? "You don't know Ines yet" : undefined, "1 favour");
        opt("wait", "Wait it out", false, "Tidewater won't wait — they'll take the car");
      } else {
        opt("reroute", "Reroute via the port bridge (certain, slower)", true, undefined, "time");
        opt("wait", `Wait in line (${pct("wait_checkpoint")} chance)`, true, undefined, "time");
        opt("call_contact", "Ask Mara to make a call (certain)", favors >= 1, favors < 1 ? "No favours left" : undefined, "1 favour");
        opt("negotiate", "Bribe the officer", false, "Officer Dade doesn't take money");
      }
      opt("abandon", "Abandon the delivery", true, undefined, "no reward");
    }
    return out;
  }

  agentLegal(state: WorldState) {
    const m = state.mission;
    const wren = state.actors.wren;
    const out: { command: AgentCommand["command"]; target?: string; label: string; enabled: boolean; reason?: string }[] = [];
    if (!wren) return out;
    const busyInvestigating = m?.stage === "investigating";
    out.push({ command: "investigate", label: "Investigate lead", enabled: m?.stage === "lead", reason: m?.stage === "lead" ? undefined : "No open lead to investigate" });
    for (const id of ["mara", "ines", "dorian", "bo"]) {
      const known = state.introduced.includes(id);
      const cooling = state.simTime - (state.contactCooldown[id] ?? -1e9) < 120;
      const needsPresence = id === "bo" && !(wren.nodeId === "velvet" && !wren.route);
      out.push({ command: "contact", target: id, label: `Contact ${state.actors[id].name}`, enabled: known && !cooling && !needsPresence, reason: !known ? "Not introduced yet" : needsPresence ? "Bo only talks in person at The Velvet Room" : cooling ? "Just talked — give it a minute" : undefined });
    }
    out.push({ command: "travel", target: "*", label: "Travel to a location", enabled: !busyInvestigating, reason: busyInvestigating ? "Busy investigating" : undefined });
    out.push({ command: "wait", label: m?.stage === "complication" && m.complication?.type === "checkpoint" ? "Tell the driver to wait" : "Hold position", enabled: m?.stage === "complication" ? m.complication?.type === "checkpoint" : !!wren.route && !busyInvestigating, reason: m?.stage === "complication" && m.complication?.type !== "checkpoint" ? "Waiting isn't an option here" : !wren.route ? "Already holding" : busyInvestigating ? "Busy investigating" : undefined });
    out.push({ command: "return", label: "Return to safehouse", enabled: wren.nodeId !== "safehouse" && !busyInvestigating, reason: wren.nodeId === "safehouse" ? "Already at the safehouse" : busyInvestigating ? "Busy investigating" : undefined });
    return out;
  }

  // -------------------------------------------------------------------------
  // Sanitised view for one viewer
  // -------------------------------------------------------------------------
  view(state: WorldState, viewerSessionId: string | null) {
    const owner = state.kind === "session" && viewerSessionId === state.ownerSessionId;
    const playerFacts = state.facts.filter((f) => f.holders.includes("player") || f.holders.includes("wren"));
    const knows = (k: string) => playerFacts.some((f) => f.key === k);
    const m = state.mission;
    return {
      id: state.id, kind: state.kind, owner, simTime: state.simTime, clock: clock(state.simTime), seq: state.seq, simRate: RULES.simRate,
      actors: Object.values(state.actors).map((a) => ({
        id: a.id, name: a.name, role: a.role, pos: a.pos, nodeId: a.nodeId,
        route: a.route ? { nodes: a.route.nodes, seg: a.route.seg, segPos: a.route.segPos } : null,
        moving: !!a.route && a.holdUntil == null, speed: a.speed,
        // Rival intentions are not public; their visible behaviour is.
        task: a.id === "tamsin" && a.locked ? (knows("route_plan") ? "Staged an intercept on your route" : "Driving somewhere in a hurry") : a.task,
        inventory: a.id === "wren" || (owner && a.id === m?.driverId) ? a.inventory : [],
        debts: owner && knows("nico_debt") ? a.debts : [],
        memory: a.id === "wren" && owner ? a.memory.slice(-6) : [],
        bio: CAST.find((c) => c.id === a.id)?.bio ?? "",
        trust: owner ? { value: state.trust[a.id] ?? 0, label: trustLabel(state.trust[a.id] ?? 0) } : null,
        contact: owner ? state.introduced.includes(a.id) : false,
      })),
      facts: owner ? playerFacts.map((f) => ({ key: f.key, text: f.text, learnedAt: clock(f.learnedAt) })) : [],
      leads: owner ? state.leads : [],
      resources: owner ? state.resources : null,
      checkpoint: { active: state.checkpoint.active, until: state.checkpoint.active ? clock(RULES.checkpoint.liftAt) : null },
      mission: owner && m ? {
        id: m.id, stage: m.stage, driverId: m.driverId, route: m.route, routeNodes: RULES.routes[m.route], precautions: m.precautions,
        complication: m.complication ? { ...m.complication, secondsLeft: Math.max(0, m.complication.deadline - state.simTime) / RULES.simRate } : null,
        responses: m.responses, outcome: m.outcome, nextLeadId: m.nextLeadId, demoAssisted: m.demoAssisted,
        leakRevealed: m.leak.leaked && m.stage === "resolved",
        knownRisks: [
          ...(knows("nico_debt") && state.actors.nico.debts.some((d) => !d.resolved) ? ["Nico owes Cass Rourke $400 — Tidewater has been asking about him."] : []),
          ...(state.checkpoint.active ? [`VCPD checkpoint on the causeway approach until ${clock(RULES.checkpoint.liftAt)}.`] : []),
          ...(knows("nico_debt_settled") ? ["Nico's debt is settled."] : []),
        ],
        contract: { title: "The Night Shift", objective: "Move the coupe from The Velvet Room to Berth 14 for Dorian Salt.", reward: { amount: RULES.reward.amount, unit: RULES.reward.unit }, conditions: "Coupe reaches Berth 14 intact. One reward per guest session; failed or abandoned runs earn nothing.", payout: "$900 on time, $600 if after " + clock(RULES.deliveryDeadline), fees: RULES.fees, deadline: clock(RULES.deliveryDeadline) },
        actions: this.legal(state),
      } : null,
      agentActions: owner ? this.agentLegal(state) : [],
      places: this.places,
      history: owner ? state.history : [],
    };
  }
}

function keyOf(cmd: any): string {
  switch (cmd.action) {
    case "ask_about": case "settle_debt": case "choose_driver": return `${cmd.action}:${cmd.actorId}`;
    case "precaution": return `precaution:${cmd.id}`;
    case "choose_route": return `choose_route:${cmd.route}`;
    case "respond": return `respond:${cmd.option}`;
    default: return cmd.action;
  }
}

export type WorldView = ReturnType<Engine["view"]>;
