const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (d: React.ReactNode) => () => <svg viewBox="0 0 24 24" aria-hidden="true" {...P}>{d}</svg>;

export const Icon = {
  measure: svg(<><path d="M3 17 17 3l4 4L7 21z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" /></>),
  draw: svg(<><path d="M4 20c4-1 6-3 8-6s4-7 8-10" /><circle cx="4" cy="20" r="1.2" /></>),
  grid: svg(<><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>),
  cluster: svg(<><circle cx="8" cy="8" r="3" /><circle cx="16" cy="9" r="2" /><circle cx="11" cy="16" r="4" /></>),
  heat: svg(<><path d="M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z" /></>),
  route: svg(<><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5" /></>),
  fov: svg(<><path d="M12 20 4 6h16z" /><circle cx="12" cy="20" r="1" /></>),
  agent: svg(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></>),
  layers: svg(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>),
  feed: svg(<><path d="M4 5h16M4 12h16M4 19h10" /></>),
  mission: svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>),
  atlas: svg(<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>),
  search: svg(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>),
  undo: svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  redo: svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>),
  trash: svg(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  target: svg(<><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  minus: svg(<path d="M5 12h14" />),
  compass: svg(<><circle cx="12" cy="12" r="9" /><path d="m12 5 3 7h-6z" fill="currentColor" /><path d="m12 19-3-7h6z" /></>),
  chevronLeft: svg(<path d="m15 5-7 7 7 7" />),
  chevronRight: svg(<path d="m9 5 7 7-7 7" />),
  fit: svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>),
};
