/** Compact atlas row served to the web client: see scripts/verify-coverage.ts. */
export type CompactRecord = [
  id: string,
  datasetIndex: number,
  label: string,
  category: string,
  tags: string[],
  x: number | null,
  y: number | null,
  hasRealWorld: 0 | 1,
  hasPhoto: 0 | 1,
  fov: [heading: number, angle: number, range: number] | 0,
  color: string | null,
];

export interface AtlasBundle {
  generatedAt: string;
  datasets: string[];
  records: CompactRecord[];
}

export const DATASET_LABELS: Record<string, string> = {
  gtadb_landmarks: "Landmarks (GTADB)",
  sol_screenshots: "Screenshots",
  sol_leaks: "Leaks",
  sol_trailer1: "Trailer 1",
  sol_trailer2: "Trailer 2",
  sol_trailer3: "Trailer 3",
  sol_el_screenshots: "Extended Look screenshots",
};

export const DATASET_COLORS: Record<string, string> = {
  gtadb_landmarks: "#7884F7",
  sol_screenshots: "#F7A35C",
  sol_leaks: "#F4717C",
  sol_trailer1: "#F976B0",
  sol_trailer2: "#B1A1E8",
  sol_trailer3: "#5FE3A1",
  sol_el_screenshots: "#FFDF80",
};

export const REWARD_UNIT_LABEL: Record<string, string> = {
  VP_POINTS: "app points",
};
