# Itinerary endpoint delivery

One ticket per branch and pull request. These changes form a dependency stack;
merge in ticket order, retargeting the next pull request to `develop` after its
parent lands. Each pull request shows only its own ticket delta.

| Jira | Requirement | Endpoint behavior |
| --- | --- | --- |
| SCRUM-89 | ITN-01 | Create a private itinerary |
| SCRUM-90 | ITN-03 | List current user itineraries |
| SCRUM-91 | ITN-03 | Read itinerary details with ownership checks |
| SCRUM-92 | ITN-01 | Update itinerary metadata and visibility |
| SCRUM-93 | ITN-01 | Delete an itinerary and child records |
| SCRUM-94 | ITN-05 | Append an itinerary day |
| SCRUM-95 | ITN-05 | Update itinerary day metadata |
| SCRUM-96 | ITN-07 | Delete a day and recalculate numbering and dates |
| SCRUM-97 | ITN-08 | Reorder itinerary days and dates |
| SCRUM-98 | ITN-10 | Add an activity to an itinerary day |
| SCRUM-99 | ITN-10 | Update an owned itinerary activity |
| SCRUM-100 | ITN-10 | Delete an owned itinerary activity |

Each ticket is checked with `npm run lint`, `npm run build` and `npm test`.
Database tests use an isolated local MongoDB replica set and never load application environment files.
