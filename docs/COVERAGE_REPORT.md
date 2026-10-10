# Source coverage report

Generated 2026-10-09T21:16:52.497Z by `pnpm coverage`. Machine-readable: `data/source-manifests/coverage-report.json`.

Primary reference: <https://map.stateofleonida.net/?marker=L588>

## Count reconciliation (snapshot observed 2026-10-09)

| | Imported here | Observed at source | Match |
|---|---:|---:|:--:|
| Database overview total | 3282 | 3282 | yes |
| Rendered markers | 3222 | 3222 | yes |
| Rendered landmark layer | 3040 | 3040 | yes |

3100 landmarks + 182 non-landmark records = 3282 (observed 3282).

Source parseMarker() returns null for landmarks with neither game nor real-world coordinates. In this snapshot that is 60 records → 3040 landmark markers (observed 3040); + 182 = 3222 (observed 3222).

**The missing 60:** L533, L534, L816, L817, L835, L889, L891, L936, L937, L938, L981, L985, L986, L987, L988, L989, L991, L993, L994, L995, L996, L997, L998, L999, L1001, L1026, L1028, L1032, L1033, L1034, L1035, L1041, L1077, L1111, L1207, L1295, L1314, L1384, L1392, L1393, L1395, L1396, L1397, L1437, L1457, L1468, L1491, L1493, L1495, L1837, L2164, L2170, L2182, L2184, L2186, L2192, L2232, L2364, L2980, L3086

Reproduced from source client code + our snapshot. The source's own GTADB sync revision is shown only in an admin endpoint, so equality of snapshots is inferred from matching counts, not verified. The 60 records are kept, searchable in the data view, and flagged 'no coordinates'. 41 further records have real-world but no game coordinates; they appear in lists and the real-world view, not on the game map.

## Datasets

| Dataset | Raw | Unique IDs | Game XY | Real-world | No coords | Inside display crop | Media refs | FOV |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gtadb_landmarks | 3100 | 3100 | 2999 | 1819 | 60 | 2999 | 3789 | 0 |
| sol_screenshots | 47 | 47 | 47 | 0 | 0 | 47 | 46 | 26 |
| sol_leaks | 42 | 42 | 42 | 0 | 0 | 42 | 79 | 0 |
| sol_trailer1 | 30 | 30 | 30 | 0 | 0 | 30 | 57 | 26 |
| sol_trailer2 | 26 | 26 | 26 | 0 | 0 | 26 | 26 | 20 |
| sol_trailer3 | 37 | 37 | 37 | 0 | 0 | 37 | 55 | 35 |
| sol_el_screenshots | 5 | 5 | 5 | 0 | 0 | 5 | 5 | 5 |

`el_screenshots.json` (5): Not one of the six overview datasets. All IDs also occur in screenshots.json; treated as an alternate (Extended Look) view of those records, not as new records.

## Media

- Source "Screenshots" tab showed 166 entries — **pending permission** (listing endpoint disallowed by robots.txt). This is distinct from the 47 screenshot markers.
- Artwork and trailer tab totals: not discovered (same endpoint).
- Official Rockstar archives: linked, not downloaded (Screenshots 99, Artwork and wallpapers 23, Clips 9, Ultimate Edition benefit screenshots 51, Vintage Vice City pack screenshots 12).

## Asset status

| Asset | Kind | Status | Reason |
|---|---|---|---|
| gtadb_landmarks | dataset | imported | CC BY 4.0; bundled snapshot byte-identical to pinned commit. |
| gtadb_photos | media | linked | Fetched on demand from the pinned GitHub commit and cached; underlying game imagery © Rockstar, real-world photo provenance per file not stated. |
| gtadb_tiles_yanis16 | basemap | imported | z1–z4 cached from GitHub (scripts/prepare-map.ts); z5–z6 on demand within a daily budget. |
| sol_screenshots | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_leaks | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_trailer1 | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_trailer2 | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_trailer3 | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_el_screenshots | dataset | imported | Public /data/*.json (robots.txt Allow: /data/). Kept in the gitignored local cache; redistribution rights not established, so it is not committed. |
| sol_media_files | media | linked | Rockstar screenshots/trailer frames hosted by the source; referenced by URL, never copied. |
| sol_yanis_v16_tiles | basemap | linked | 30 zoom-2 tiles cached locally for registration comparison only. |
| sol_rickrick_tiles | basemap | pending_permission | Revision metadata recorded; tiles not retrieved. |
| sol_historical_overlays | comparison | pending_permission | GTA V/IV/VC/SA/RDR2 map images are third-party game maps; bounds recorded, local asset slots provided. |
| sol_credits | provenance | imported | Shown as attribution in the Sources drawer. |
| sol_database_changelog | provenance | imported | Recent-change history exposed publicly. |
| sol_media_listing | media | pending_permission | get-media-files.php disallowed by robots.txt. |
| sol_leaderboard_users | accounts | unavailable | Other site's users/scores are not imported by design. |
| sol_community_hub | feature | unavailable | Labelled 'Coming soon' at inspection; hidden functionality not invented. |

## Feature parity

| Area | Status | Notes |
|---|---|---|
| Basemaps | partial | GTADB yanis,16 (artwork V17 WIP) rendered with tile LOD z1-z6. Source YANIS v7.0-v16.0, RickRick v1-v3, DuPz0r revision metadata, dates, variants (normal/dark/nocams) listed in the revision selector; SoL-hosted tiles are linked, not redistributed. v16.0 registration compared (0 px residual at 16 u/px). |
| Historical comparison | partial | GTA V, GTA IV, Vice City, San Andreas, RDR2 slots with source bounds, opacity, registered placement and scale-assumption note. Assets pending permission; owner can drop files in apps/web/public/assets/maps/compare/. |
| Markers | implemented | 3,100 GTADB + 182 SoL records with stable IDs, categories, uncertainty punctuation, tags, coordinates, credits, raw edited values, reference links and media relations. |
| Marker browser | implemented | Search, dataset/category toggles, sort, counts, clustering, compact/normal density, selection, focus, durable ?marker= links. |
| Detail windows | implemented | Game photo / real-world photo (GTADB, cached), source media links, real-life address, game XY, tags, edited raw + interpreted, lightbox, copy link/coords, Google Earth and GTA Wiki search links. |
| Spatial inspection | implemented | Cursor coordinate readout, coordinate search, grid, km/mi measurement, source-supplied FOV wedges (absent angles stay unknown). |
| Drawing | implemented | Pen, line, rectangle, circle, palette + custom colour, thickness, opacity, undo/redo/clear, saved per guest session in game coordinates. |
| Analytical layers | implemented | Clustering toggle and radius, cluster/marker colours, marker-density heatmap labelled as marker density. |
| Real-world comparison | implemented | Separate OpenStreetMap view in lat/lon with OSM attribution; never mixed with game XY. |
| Media library | partial | Marker-linked screenshots/trailers/leaks with search, categories, go-to-location and source links. Thumbnails are opt-in source links. Source media tab totals pending (robots-disallowed endpoint). |
| Marker Finder | implemented | Original screenshot-to-map game, server-held answers, distance scoring, 5 rounds, results and our own leaderboard. Points capped; not an unlimited reward source. |
| Customization | implemented | Dark themes, glass/border options, accent colour, original gradient backgrounds, rail arrangement, metric/imperial, English/German. |
| Provenance | implemented | Database overview, reconciliation, update status, source change history, creator credits, map revision history, public adaptations list. |
| Community Hub | not_applicable | Source shows 'Coming soon'. VICEPULSE ships its own live feed/mission hub instead. |

Additional source capabilities discovered during implementation: Camera motion playback (heading, FOV, path, video sync in/out) (partial: static FOV + path drawn; video sync not reproduced); No-cams tile variants (listed in revision selector); Per-tag image visibility rules (showInGame/showRealLife) (not reproduced: rules are server-side); News articles (data/news.json) (linked count in Sources); Supporters list (not reproduced (donation-related)); GTA Wiki lookup cache (replaced by search link); OSM real-life map mode (implemented as Real-world view); Accounts, ranks, notifications, marker studio (own guest sessions; source accounts not copied).
