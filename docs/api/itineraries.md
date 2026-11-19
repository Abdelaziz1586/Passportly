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
| SCRUM-101 | ITN-12 | Upload a validated activity image |
| SCRUM-102 | ITN-12 | Remove an activity image |
| SCRUM-103 | ITN-14 | Add a daily budget entry |
| SCRUM-104 | ITN-14 | Update an owned budget entry |
| SCRUM-105 | ITN-14 | Delete an owned budget entry |
| SCRUM-106 | ITN-16 | Add an intercity transport cost |
| SCRUM-107 | ITN-16 | Update an intercity transport cost |
| SCRUM-108 | ITN-16 | Delete an intercity transport cost |
| SCRUM-109 | ITN-18 | Calculate a budget summary with cached FX rates |
| SCRUM-110 | ITN-20 | Search and filter public itineraries |
| SCRUM-111 | ITN-21 | Read public itinerary details and attribution |
| SCRUM-112 | ITN-21 | Clone a public itinerary into a private copy |
| SCRUM-113 | ITN-25 | Search available hotels from itinerary context |
| SCRUM-114 | ITN-26 | Search flights from itinerary context |
| SCRUM-115 | ITN-27 | Attach an owned confirmed booking |

Each ticket is checked with `npm run lint`, `npm run build` and `npm test`.
Database tests use an isolated local MongoDB replica set and never load application environment files.
