export interface GraphNode { id: string; game: [number, number]; sourceRecordId: string | null; authored?: string }
export interface GraphEdge { from: string; to: string; crossing: "land" | "bridge" | "tunnel"; bridgeRecordId?: string }

export class RouteGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly adj = new Map<string, { to: string; dist: number; edge: GraphEdge }[]>();

  constructor(nodes: GraphNode[], readonly edges: GraphEdge[]) {
    for (const n of nodes) { this.nodes.set(n.id, n); this.adj.set(n.id, []); }
    for (const e of edges) {
      const a = this.node(e.from), b = this.node(e.to);
      const dist = Math.hypot(a.game[0] - b.game[0], a.game[1] - b.game[1]);
      this.adj.get(e.from)!.push({ to: e.to, dist, edge: e });
      this.adj.get(e.to)!.push({ to: e.from, dist, edge: e });
    }
  }

  node(id: string) {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown route node ${id}`);
    return n;
  }

  hasEdge(a: string, b: string) {
    return !!this.adj.get(a)?.some((e) => e.to === b);
  }

  /** Dijkstra; `avoid` excludes nodes (except endpoints). Returns node IDs including both ends, or null. */
  shortestPath(from: string, to: string, avoid: Set<string> = new Set()): string[] | null {
    if (from === to) return [from];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    while (open.size) {
      let cur = "", best = Infinity;
      for (const n of open) { const d = dist.get(n)!; if (d < best) { best = d; cur = n; } }
      open.delete(cur);
      if (cur === to) break;
      for (const e of this.adj.get(cur) ?? []) {
        if (avoid.has(e.to) && e.to !== to) continue;
        const nd = best + e.dist;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); open.add(e.to); }
      }
    }
    if (!prev.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0])!);
    return path;
  }

  pathLength(path: string[]) {
    let d = 0;
    for (let i = 1; i < path.length; i++) {
      const a = this.node(path[i - 1]).game, b = this.node(path[i]).game;
      d += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    return d;
  }

  /** Every consecutive pair must be an authored edge. */
  isValidPath(path: string[]) {
    return path.length > 0 && path.every((n) => this.nodes.has(n)) && path.slice(1).every((n, i) => this.hasEdge(path[i], n));
  }
}
