GTA VI PROJECT RESEARCH PACK
Checked: 9 October 2026 (Europe/Oslo)

This is a source-backed starting point for a fan map, companion, research site or other GTA VI project. It is a snapshot of the major information sources located, not a claim to contain every public detail. Sources can change before release.

START HERE
1. sources.json: source catalog with evidence types and access limitations.
2. verified-project-facts.json: compact seed data for official names, launch information and clearly attributed reports.
3. official-download-links.json: official archive URLs. Large Rockstar media archives are linked, not bundled.
4. community-data/: original and normalized landmark JSON, community map overview and data license.
5. community-data-manifest.json: provenance, count, checksum and caveats.
6. suggested-location-schema.json: proposed record structure for your own project.

MAPS AND GEOGRAPHY
Browse https://map.gtadb.org and https://map.stateofleonida.net.
Compare https://www.gtabase.com/gta-6/map/ and the evidence-card approach at https://gtami.com/en/map/ (the latter was available in search indexing but could not be opened directly during this research).
The official collector box advertises a map on a poster's reverse. Its product image was inspected and does not reveal a readable road map. No usable official digital road map was verified in this research.
Do not treat community coordinates, estimated roads, boundaries, map area or real-world matches as official. A named place can be official while its proposed position remains uncertain. Several maps may share the same underlying reconstruction; agreement is not independent corroboration.

COMMUNITY DATA
The included GTADB download contains 3,100 records. This is a community dataset count, not 3,100 officially confirmed locations. Its original structure and bytes are preserved. The published license is included; use the attribution in the manifest. External photographs, Rockstar screenshots and trademarks should keep their own attribution and rights records.
The repository is https://github.com/rolux/gtadb.org. Its code uses MIT and data uses CC BY 4.0. Upstream asks users to synchronize through GitHub rather than hotlinking its live data/media service.
An upstream-recommended sparse checkout selection is:
  git sparse-checkout set map/data/6 map/photos/6 maps/tiles/6
Run that only inside an appropriately initialized sparse checkout of the repository.
The API documentation at https://api.gtadb.org is experimental. It describes geocoding, landmarks, elevation and static maps. Its route and Maps JavaScript APIs are marked coming soon. A community API is not an official game API and is not live player telemetry. No endpoints were load-tested.

OFFICIAL MEDIA
Begin with Rockstar's media hub, its two trailers and the August 2026 Extended Look. Use the official archive links for original images rather than compressed social reposts. Keep asset attribution and source URLs. A promotional download link does not by itself give blanket commercial reuse rights.
The people/location page is a useful authoritative source for names. The screenshot catalog also directly names businesses and some vehicles/equipment. Keep those official labels separate from visual identification guesses.

GAMEPLAY AND WORLD INFORMATION
For recent developer statements, the open Game Informer wildlife and weather articles are useful first-hand reporting. The full cover story is paywalled and was not fully inspected here.
PC Gamer's Extended Look coverage has both a development-leaks section and later observations of the official showcase. Only the later official-footage observations were used in the seed data. Visible action does not prove a full standalone activity system, permanent world rule or final release behavior.
GTA Base is a discovery catalog for vehicles, weapons and locations. Its vehicle page lists 298 entries at this check; this is that site's catalog size. Its weapons page explicitly includes leaked development footage, so validate each item before labelling it official.

A USEFUL PROJECT SHAPE (PROPOSAL)
Build a searchable Leonida atlas with evidence attached to every pin. Let users filter official names, observed objects and speculative placements separately. A pin should link to the precise screenshot or video timestamp that supports it.
Separate database tables or collections for sources, places, people, vehicles, equipment, media and claims. Claims should be independent of places: a location can have a verified name, an estimated position and an unverified gameplay function.
Support source dates, correction history, map versions, spoiler controls and duplicate detection. Let users bookmark locations and make personal checklists. Add routes only when a trustworthy navigable road graph exists.
Treat screenshot matching, a map quiz and a source-grounded question-answer assistant as optional features. An assistant should cite records and say when a location is unknown. It should never invent coordinates from a landmark's name.
If your project is an AI agent that plays GTA VI, this pack supplies background knowledge only. It does not supply game execution, controller integration, perception, live state or an official gameplay API.

PRE-RELEASE DEPENDENCIES TO KEEP OPEN
No PC launch date, final hardware requirements, complete collectible list, final mission database, full item statistics, GTA VI gameplay SDK, or GTA VI RP integration was verified here. The existence of Rockstar's general Creator Platform policy does not establish GTA VI support.
Do not base a product promise on rumored map size, every-building-interior claims, a complete online feature set or crypto integration without a direct current source.

HOW TO MAINTAIN THE PACK
Check Rockstar's site and Newswire first. Record publication dates and observed dates separately. Compare changes, then revise individual claims and preserve the old provenance. Refresh community data from the repository with a recorded commit and reconcile moved/renamed records. Never silently relabel imported community records as official.

The sources and proposals are original summaries. Full articles, leaked footage and game files are not included.
