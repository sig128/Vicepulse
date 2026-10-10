export type XY = [number, number];

export interface WorldEvent {
  id: string; worldId: string; sequence: number; type: string; simTime: number; createdAt: string;
  actorIds: string[]; locationId: string | null; causeEventId: string | null; visibility: string; payload: Record<string, any>;
}

export interface ActorView {
  id: string; name: string; role: string; pos: XY; nodeId: string;
  route: { nodes: string[]; seg: number; segPos: number } | null;
  moving: boolean; speed: number; task: string; inventory: string[];
  debts: { to: string; amount: number; resolved: boolean }[]; memory: string[]; bio: string;
  trust: { value: number; label: string } | null; contact: boolean;
}

export interface LegalAction { key: string; label: string; enabled: boolean; reason?: string; cost?: string; command: Record<string, unknown> }
export interface AgentAction { command: string; target?: string; label: string; enabled: boolean; reason?: string }

export interface MissionView {
  id: string; stage: "lead" | "investigating" | "offer" | "pickup" | "delivery" | "complication" | "resolved" | "declined";
  driverId: string | null; route: "causeway" | "south_bridge"; routeNodes: string[]; precautions: string[];
  complication: { type: "intercept" | "checkpoint"; node: string; deadline: number; secondsLeft: number; causeEventId: string | null } | null;
  responses: { option: string; success: boolean; automatic: boolean; eventId: string }[];
  outcome: "delivered" | "delivered_late" | "lost" | "abandoned" | "declined" | null;
  nextLeadId: string | null; demoAssisted: boolean; leakRevealed: boolean; knownRisks: string[];
  contract: { title: string; objective: string; reward: { amount: number; unit: string }; conditions: string; payout: string; fees: Record<string, number>; deadline: string };
  actions: LegalAction[];
}

export interface WorldView {
  id: string; kind: "session" | "shared"; owner: boolean; simTime: number; clock: string; seq: number; simRate: number;
  actors: ActorView[]; facts: { key: string; text: string; learnedAt: string }[];
  leads: { id: string; title: string; text: string; status: string; locationId: string | null }[];
  resources: { cash: number; favors: number } | null;
  checkpoint: { active: boolean; until: string | null };
  mission: MissionView | null; agentActions: AgentAction[];
  places: { id: string; name: string; node: string; sourceRecordId: string | null }[];
  history: { missionId: string; outcome: string; driverId: string | null; leaked: boolean }[];
}

export interface Scenario {
  id: string; title: string; note: string;
  places: { id: string; name: string; kind: string; node: string; sourceRecordId: string | null; blurb: string }[];
  nodes: { id: string; game: XY; sourceRecordId?: string; label?: string }[];
  edges: { from: string; to: string; crossing: string }[];
  cast: { id: string; name: string; role: string; bio: string }[];
}

export interface Me { displayName: string; since: string; sessionWorldId: string; sharedWorldId: string; demoControls: boolean }

export type Shape =
  | { kind: "pen" | "line"; points: XY[]; color: string; width: number; opacity: number }
  | { kind: "rect"; points: [XY, XY]; color: string; width: number; opacity: number }
  | { kind: "circle"; points: [XY, XY]; color: string; width: number; opacity: number };
