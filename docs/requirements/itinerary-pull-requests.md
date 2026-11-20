# Itinerary pull requests

The combined PR [#88](https://github.com/Abdelaziz1586/Passportly/pull/88) is closed.
Each of the 28 Jira tasks has its own feature branch and pull request.

## Merge order

These PRs form a dependency stack. Start with SCRUM-89 targeting `develop`.
Each later PR targets the preceding ticket branch, so its diff contains only its
own ticket changes. Merge the parent with a merge commit, then retarget the next
PR to `develop`. If using squash merges, rebase the remaining stack onto the new
`develop` before retargeting. No PRs were merged as part of this delivery.

| Jira task | Pull request | Branch | Depends on |
| --- | --- | --- | --- |
| [SCRUM-89](https://passportly.atlassian.net/browse/SCRUM-89) | [#89](https://github.com/Abdelaziz1586/Passportly/pull/89) | `feature/SCRUM-89-ITN-01-create-itinerary` | develop |
| [SCRUM-90](https://passportly.atlassian.net/browse/SCRUM-90) | [#90](https://github.com/Abdelaziz1586/Passportly/pull/90) | `feature/SCRUM-90-ITN-03-list-itineraries` | #89 |
| [SCRUM-91](https://passportly.atlassian.net/browse/SCRUM-91) | [#91](https://github.com/Abdelaziz1586/Passportly/pull/91) | `feature/SCRUM-91-ITN-03-get-itinerary` | #90 |
| [SCRUM-92](https://passportly.atlassian.net/browse/SCRUM-92) | [#92](https://github.com/Abdelaziz1586/Passportly/pull/92) | `feature/SCRUM-92-ITN-01-update-itinerary` | #91 |
| [SCRUM-93](https://passportly.atlassian.net/browse/SCRUM-93) | [#93](https://github.com/Abdelaziz1586/Passportly/pull/93) | `feature/SCRUM-93-ITN-01-delete-itinerary` | #92 |
| [SCRUM-94](https://passportly.atlassian.net/browse/SCRUM-94) | [#94](https://github.com/Abdelaziz1586/Passportly/pull/94) | `feature/SCRUM-94-ITN-05-add-itinerary-day` | #93 |
| [SCRUM-95](https://passportly.atlassian.net/browse/SCRUM-95) | [#95](https://github.com/Abdelaziz1586/Passportly/pull/95) | `feature/SCRUM-95-ITN-05-update-itinerary-day` | #94 |
| [SCRUM-96](https://passportly.atlassian.net/browse/SCRUM-96) | [#96](https://github.com/Abdelaziz1586/Passportly/pull/96) | `feature/SCRUM-96-ITN-07-delete-itinerary-day` | #95 |
| [SCRUM-97](https://passportly.atlassian.net/browse/SCRUM-97) | [#97](https://github.com/Abdelaziz1586/Passportly/pull/97) | `feature/SCRUM-97-ITN-08-reorder-days` | #96 |
| [SCRUM-98](https://passportly.atlassian.net/browse/SCRUM-98) | [#98](https://github.com/Abdelaziz1586/Passportly/pull/98) | `feature/SCRUM-98-ITN-10-add-activity` | #97 |
| [SCRUM-99](https://passportly.atlassian.net/browse/SCRUM-99) | [#99](https://github.com/Abdelaziz1586/Passportly/pull/99) | `feature/SCRUM-99-ITN-10-update-activity` | #98 |
| [SCRUM-100](https://passportly.atlassian.net/browse/SCRUM-100) | [#100](https://github.com/Abdelaziz1586/Passportly/pull/100) | `feature/SCRUM-100-ITN-10-delete-activity` | #99 |
| [SCRUM-101](https://passportly.atlassian.net/browse/SCRUM-101) | [#101](https://github.com/Abdelaziz1586/Passportly/pull/101) | `feature/SCRUM-101-ITN-12-upload-activity-image` | #100 |
| [SCRUM-102](https://passportly.atlassian.net/browse/SCRUM-102) | [#102](https://github.com/Abdelaziz1586/Passportly/pull/102) | `feature/SCRUM-102-ITN-12-delete-activity-image` | #101 |
| [SCRUM-103](https://passportly.atlassian.net/browse/SCRUM-103) | [#103](https://github.com/Abdelaziz1586/Passportly/pull/103) | `feature/SCRUM-103-ITN-14-add-budget-entry` | #102 |
| [SCRUM-104](https://passportly.atlassian.net/browse/SCRUM-104) | [#104](https://github.com/Abdelaziz1586/Passportly/pull/104) | `feature/SCRUM-104-ITN-14-update-budget-entry` | #103 |
| [SCRUM-105](https://passportly.atlassian.net/browse/SCRUM-105) | [#105](https://github.com/Abdelaziz1586/Passportly/pull/105) | `feature/SCRUM-105-ITN-14-delete-budget-entry` | #104 |
| [SCRUM-106](https://passportly.atlassian.net/browse/SCRUM-106) | [#106](https://github.com/Abdelaziz1586/Passportly/pull/106) | `feature/SCRUM-106-ITN-16-add-transport-cost` | #105 |
| [SCRUM-107](https://passportly.atlassian.net/browse/SCRUM-107) | [#107](https://github.com/Abdelaziz1586/Passportly/pull/107) | `feature/SCRUM-107-ITN-16-update-transport-cost` | #106 |
| [SCRUM-108](https://passportly.atlassian.net/browse/SCRUM-108) | [#108](https://github.com/Abdelaziz1586/Passportly/pull/108) | `feature/SCRUM-108-ITN-16-delete-transport-cost` | #107 |
| [SCRUM-109](https://passportly.atlassian.net/browse/SCRUM-109) | [#109](https://github.com/Abdelaziz1586/Passportly/pull/109) | `feature/SCRUM-109-ITN-18-budget-summary` | #108 |
| [SCRUM-110](https://passportly.atlassian.net/browse/SCRUM-110) | [#110](https://github.com/Abdelaziz1586/Passportly/pull/110) | `feature/SCRUM-110-ITN-20-search-public-itineraries` | #109 |
| [SCRUM-111](https://passportly.atlassian.net/browse/SCRUM-111) | [#111](https://github.com/Abdelaziz1586/Passportly/pull/111) | `feature/SCRUM-111-ITN-21-get-public-itinerary` | #110 |
| [SCRUM-112](https://passportly.atlassian.net/browse/SCRUM-112) | [#112](https://github.com/Abdelaziz1586/Passportly/pull/112) | `feature/SCRUM-112-ITN-21-clone-itinerary` | #111 |
| [SCRUM-113](https://passportly.atlassian.net/browse/SCRUM-113) | [#113](https://github.com/Abdelaziz1586/Passportly/pull/113) | `feature/SCRUM-113-ITN-25-itinerary-hotel-search` | #112 |
| [SCRUM-114](https://passportly.atlassian.net/browse/SCRUM-114) | [#114](https://github.com/Abdelaziz1586/Passportly/pull/114) | `feature/SCRUM-114-ITN-26-itinerary-flight-search` | #113 |
| [SCRUM-115](https://passportly.atlassian.net/browse/SCRUM-115) | [#115](https://github.com/Abdelaziz1586/Passportly/pull/115) | `feature/SCRUM-115-ITN-27-attach-booking-itinerary` | #114 |
| [SCRUM-116](https://passportly.atlassian.net/browse/SCRUM-116) | [#116](https://github.com/Abdelaziz1586/Passportly/pull/116) | `feature/SCRUM-116-ITN-28-export-itinerary-pdf` | #115 |

## Verification

Every ticket branch passed lint, build and its available regression tests before
being committed and pushed. The final branch passes **65 tests in 6 suites**,
including all itinerary integration tests and guard tests. Database tests use a
disposable local MongoDB replica set and do not read application environment files.
