/**
 * Original VICEPULSE cast. Fictional people; any resemblance to GTA VI characters is unintended.
 * `bio` is public background the player can read; `secrets` are facts only some actors hold.
 */
export interface CastMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  home: string;
  haunts: string[];
  speed: number; // game units per sim second
  contact: boolean;
  initialTrust: number;
}

export const CAST: CastMember[] = [
  { id: "wren", name: "Wren", role: "Your agent · operative", bio: "Quiet, observant, works for you. Knows the Crosstown streets and nothing about anyone's debts until told.", home: "safehouse", haunts: [], speed: 6, contact: false, initialTrust: 3 },
  { id: "vega", name: "Vega", role: "Street photographer", bio: "Shoots neon and chrome for a night-life feed. Posts what she sees, sometimes what she hears.", home: "velvet", haunts: ["velvet", "bayside", "catalan_s", "vice_beach", "catalan_n"], speed: 4, contact: false, initialTrust: 0 },
  { id: "mara", name: "Mara Quint", role: "Fixer · Quint & Daughters Autobody", bio: "Moves cars for people who don't ask why. Values discretion over speed.", home: "la_perle", haunts: [], speed: 8, contact: true, initialTrust: 0 },
  { id: "dorian", name: "Dorian Salt", role: "Collector", bio: "Buys rare coupes, pays on time, hates surprises at Berth 14.", home: "port_berth", haunts: [], speed: 8, contact: false, initialTrust: 0 },
  { id: "nico", name: "Nico Reyes", role: "Driver", bio: "Fast, cheap, charming. Drinks his coffee at Café Martí.", home: "little_cuba", haunts: ["little_cuba", "velvet", "salton_marina"], speed: 11, contact: false, initialTrust: 0 },
  { id: "jules", name: "Jules Okafor", role: "Driver", bio: "Careful, expensive, has run jobs for Mara for years.", home: "bayside", haunts: ["bayside", "catalan_n", "safehouse"], speed: 9.5, contact: false, initialTrust: 1 },
  { id: "rourke", name: "Cass Rourke", role: "Tidewater Set", bio: "Runs boats and favours out of Tidewater Slip.", home: "watson", haunts: [], speed: 10, contact: false, initialTrust: -1 },
  { id: "tamsin", name: "Tamsin Vey", role: "Tidewater Set · lookout", bio: "Rourke's eyes on the water and the roads.", home: "watson", haunts: ["watson", "causeway_e", "tunnel_w"], speed: 10, contact: false, initialTrust: -1 },
  { id: "ines", name: "Ines Batista", role: "Mechanic · Salton River Yard", bio: "Fixes anything with an engine. Owes Mara, likes people who pay cash.", home: "salton_marina", haunts: [], speed: 14, contact: true, initialTrust: 0 },
  { id: "dade", name: "Officer Dade", role: "VCPD patrol", bio: "Works the causeway shift. By the book.", home: "catalan_s", haunts: ["catalan_s", "downtown_s", "catalan_n"], speed: 8, contact: false, initialTrust: 0 },
  { id: "bo", name: "Bo Merriweather", role: "Bartender · The Velvet Room", bio: "Hears everything said across the bar after midnight.", home: "velvet", haunts: [], speed: 5, contact: false, initialTrust: 0 },
  { id: "priya", name: "Priya Sol", role: "Host · Night Static radio", bio: "Late-night call-in show with a police scanner on the desk.", home: "la_perle", haunts: [], speed: 5, contact: false, initialTrust: 0 },
];

export const TRUST_LABELS: Record<number, string> = {
  [-3]: "Burned", [-2]: "Hostile", [-1]: "Wary", 0: "Neutral", 1: "Warm", 2: "Solid", 3: "Ride-or-die",
};
export const trustLabel = (t: number) => TRUST_LABELS[Math.max(-3, Math.min(3, Math.round(t)))];

/** Explicit, documented story numbers (docs/ARCHITECTURE.md → Night Shift rules). */
export const RULES = {
  simRate: 6, // sim seconds per real second
  startSimTime: 22 * 3600,
  startCash: 1200,
  startFavors: 1,
  fees: { nico: 200, jules: 650 } as Record<string, number>,
  settleDebtCost: 400,
  sealedRouteFavorCost: 1,
  negotiateCost: 500,
  leakThreshold: { base: 0.85, sealedRoute: 0.35, debtSettled: 0 },
  complicationWindowSim: 150,
  waitDelaySim: 180,
  success: { reroute_intercept: 0.7, call_contact_intercept: 0.9, wait_checkpoint: 0.9, reroute_checkpoint: 1, call_contact_checkpoint: 1, negotiate_intercept: 1 },
  checkpoint: { setAt: 22 * 3600 + 8 * 60, liftAt: 23 * 3600 + 30 * 60, node: "causeway_w" },
  deliveryDeadline: 23 * 3600 + 15 * 60,
  reward: { campaignId: "night-shift-s1", amount: 250, unit: "VP_POINTS" },
  routes: {
    causeway: ["velvet", "catalan_n", "causeway_w", "tunnel_w", "tunnel_mid", "tunnel_exit", "port_berth"],
    south_bridge: ["velvet", "catalan_s", "downtown_s", "port_bridge", "port_w", "port_berth"],
  } as Record<string, string[]>,
  approachNode: { causeway: "catalan_n", south_bridge: "downtown_s" } as Record<string, string>,
};
