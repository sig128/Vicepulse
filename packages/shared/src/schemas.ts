import { z } from "zod";

// ---------------------------------------------------------------------------
// Atlas: imported source records (evidence) — never mutated by story state
// ---------------------------------------------------------------------------

export const DatasetId = z.enum([
  "gtadb_landmarks",
  "sol_screenshots",
  "sol_leaks",
  "sol_trailer1",
  "sol_trailer2",
  "sol_trailer3",
  "sol_el_screenshots",
]);
export type DatasetId = z.infer<typeof DatasetId>;

export const AcquisitionStatus = z.enum(["imported", "linked", "pending_retrieval", "pending_permission", "unavailable"]);
export type AcquisitionStatus = z.infer<typeof AcquisitionStatus>;

export const FovObservation = z.object({
  headingDeg: z.number(),
  angleDeg: z.number(),
  range: z.number(),
  /** Polyline of a supplied camera path in game XY, if any. */
  path: z.array(z.tuple([z.number(), z.number()])).default([]),
  source: z.literal("source_supplied"),
});
export type FovObservation = z.infer<typeof FovObservation>;

export const MediaRef = z.object({
  kind: z.enum(["game_photo", "real_world_photo", "source_image", "video_link", "video_file", "external_link"]),
  /** Our served URL when the asset is locally cached and reusable; otherwise null. */
  localUrl: z.string().nullable(),
  /** Original URL at the source. */
  sourceUrl: z.string().nullable(),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
  credit: z.string().nullable().default(null),
  status: AcquisitionStatus,
  rightsNote: z.string(),
});
export type MediaRef = z.infer<typeof MediaRef>;

export const SourceRecord = z.object({
  /** Stable ID exactly as published by the source (e.g. "L588", "screenshots_001"). */
  id: z.string(),
  dataset: DatasetId,
  /** Label as published, uncertainty punctuation preserved (e.g. "?, La Perle, Vice City"). */
  label: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  /** Fictional game-space XY. Null when the source has none. */
  game: z.tuple([z.number(), z.number()]).nullable(),
  /** Real-world reference location. Separate coordinate space; never projected onto the game map. */
  realWorld: z
    .object({ address: z.string().nullable(), latLon: z.tuple([z.number(), z.number()]).nullable() })
    .nullable(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  /** Raw edit values as supplied (GTADB: unix seconds [record, igPhoto, rlPhoto]). */
  editedRaw: z.array(z.union([z.number(), z.string()])).nullable(),
  media: z.array(MediaRef),
  fov: FovObservation.nullable(),
  sourceUrl: z.string(),
  attribution: z.string(),
  evidenceStatus: z.enum(["community_reconstruction", "source_observation", "leak_reference", "official_media_reference"]),
  placementStatus: z.enum(["community_estimate", "unknown"]),
});
export type SourceRecord = z.infer<typeof SourceRecord>;

// ---------------------------------------------------------------------------
// Simulation events
// ---------------------------------------------------------------------------

export const Visibility = z.union([z.literal("public"), z.string().regex(/^participant:[A-Za-z0-9_-]+$/)]);

export const WorldEvent = z.object({
  id: z.string(),
  worldId: z.string(),
  sequence: z.number().int().nonnegative(),
  type: z.string(),
  simTime: z.number(),
  createdAt: z.string(),
  actorIds: z.array(z.string()),
  locationId: z.string().nullable(),
  causeEventId: z.string().nullable(),
  visibility: Visibility,
  payload: z.record(z.string(), z.unknown()),
});
export type WorldEvent = z.infer<typeof WorldEvent>;

export const PostPayload = z.object({
  authorId: z.string(),
  text: z.string().max(400),
  kind: z.enum(["observed", "rumor", "announcement"]),
  narrativeSource: z.enum(["rule_based", "model_generated"]),
  leadId: z.string().nullable().default(null),
});

export const MessagePayload = z.object({
  fromId: z.string(),
  toId: z.string(),
  text: z.string().max(600),
  narrativeSource: z.enum(["rule_based", "model_generated"]),
});

// ---------------------------------------------------------------------------
// Commands (client → server). Session identity comes from the cookie, never the body.
// ---------------------------------------------------------------------------

export const MissionCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("investigate"), leadId: z.string() }),
  z.object({ action: z.literal("ask_about"), actorId: z.string() }),
  z.object({ action: z.literal("settle_debt"), actorId: z.string() }),
  z.object({ action: z.literal("choose_driver"), actorId: z.string() }),
  z.object({ action: z.literal("choose_route"), route: z.enum(["causeway", "south_bridge"]) }),
  z.object({ action: z.literal("precaution"), id: z.literal("sealed_route") }),
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("decline") }),
  z.object({ action: z.literal("respond"), option: z.enum(["reroute", "negotiate", "call_contact", "wait", "abandon"]) }),
]);
export type MissionCommand = z.infer<typeof MissionCommand>;

export const AgentCommand = z.discriminatedUnion("command", [
  z.object({ command: z.literal("investigate") }),
  z.object({ command: z.literal("contact"), actorId: z.string() }),
  z.object({ command: z.literal("travel"), nodeId: z.string() }),
  z.object({ command: z.literal("wait") }),
  z.object({ command: z.literal("return") }),
]);
export type AgentCommand = z.infer<typeof AgentCommand>;

export const AnnotationShape = z.object({
  tool: z.enum(["pen", "line", "rect", "circle"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(1).max(24),
  opacity: z.number().min(0.05).max(1),
  /** Game-space XY points; shared by Atlas and Afterdark. */
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(2000),
});
export type AnnotationShape = z.infer<typeof AnnotationShape>;

export const SaveAnnotations = z.object({ shapes: z.array(AnnotationShape).max(300) });

export const FinderGuess = z.object({ roundId: z.string(), x: z.number().finite(), y: z.number().finite() });

export const EvidenceSubmission = z.object({
  kind: z.enum(["mapping_correction", "evidence_link", "external_gameplay"]),
  recordId: z.string().max(64).nullable(),
  note: z.string().min(4).max(1000),
  /** Only vetted source domains are accepted; the server never fetches arbitrary URLs. */
  url: z.string().url().max(500).nullable(),
  proposedGame: z.tuple([z.number(), z.number()]).nullable(),
});

export const VETTED_EVIDENCE_HOSTS = [
  "map.stateofleonida.net",
  "gtadb.org",
  "map.gtadb.org",
  "github.com",
  "www.rockstargames.com",
  "rockstargames.com",
  "www.youtube.com",
  "youtu.be",
];

// ---------------------------------------------------------------------------
// Narrative model output (validated before the simulation considers it)
// ---------------------------------------------------------------------------

export const SuggestedAction = z.object({
  actor: z.string(),
  intent: z.enum(["say", "move", "share_fact", "wait"]),
  target: z.string().nullable(),
  knownFacts: z.array(z.string()).max(6),
  preconditions: z.array(z.string()).max(6),
  dialogue: z.string().max(280),
});
export type SuggestedAction = z.infer<typeof SuggestedAction>;
