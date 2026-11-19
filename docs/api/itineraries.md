# Itinerary endpoint delivery

One ticket per branch and pull request. These changes form a dependency stack;
merge in ticket order, retargeting the next pull request to `develop` after its
parent lands. Each pull request shows only its own ticket delta.

| Jira | Requirement | Endpoint behavior |
| --- | --- | --- |
| SCRUM-89 | ITN-01 | Create a private itinerary |
| SCRUM-90 | ITN-03 | List current user itineraries |

Each ticket is checked with `npm run lint`, `npm run build` and `npm test`.
Database tests use an isolated local MongoDB replica set and never load application environment files.
