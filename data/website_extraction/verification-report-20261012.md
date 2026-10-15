# ZuiGO Phase 2: Manual Verification and Data Cleaning

**Verification date:** 2026-10-12  
**Comparison method:** Requested each snapshot's official source page over HTTPS,
checked the response against the stored source SHA-256, and compared the saved
headings, text blocks, topic mappings, and links with the current page content.
The existing Python `requests` and BeautifulSoup extraction logic was used for
the comparison. This checks the published static HTML; it does not establish
that claims on the website are independently true.

| Page | Status | Official source | Verification result |
|---|---|---|---|
| Healthcare Software Solutions | Verified | https://zuigo.ai/services/healthcare-software | Page title, introduction, solutions, five delivery stages, representative technology list, three project headings and descriptions, contact links, and the illustrative-project disclaimer match the page. Existing Healthcare-specific validation checks pass. |
| AI & Machine Learning | Verified | https://zuigo.ai/services/ai-machine-learning | Page title, introduction, outcomes, included work, five delivery stages, representative technology list, and all three project headings and descriptions match. Project examples are explicitly illustrative, not a client list. |
| Fintech Software Solutions | Verified | https://zuigo.ai/services/fintech-software | Page title, introduction, outcomes, included work, five delivery stages, representative technology list, and all three project headings and descriptions match. Project examples are explicitly illustrative, not a client list. |
| Custom Software Development | Verified | https://zuigo.ai/services/custom-software | Page title, introduction, outcomes, included work, five delivery stages, representative technology list, and all three project headings and descriptions match. Project examples are explicitly illustrative, not a client list. |
| Cloud & DevOps Solutions | Verified | https://zuigo.ai/services/cloud-devops | Page title, introduction, outcomes, included work, five delivery stages, representative technology list, and all three project headings and descriptions match. Project examples are explicitly illustrative, not a client list. |
| About ZuiGO | Verified | https://zuigo.ai/about | Page title, introduction, founder details, and all value headings and descriptions match the page. |
| Contact and location | Verified | https://zuigo.ai/contact | Email, telephone, reply-time statement, form labels, service and budget choices, 30-minute call details, booking link, and named social links match. Official structured data publishes Pune, Maharashtra, India; no street address was found in that data. |
| Book a Call | Unable to Verify | https://zuigo.ai/book | The route resolves to the Microsoft Bookings URL below, and its destination responds successfully. The destination requires JavaScript, so appointment slots and availability could not be confirmed. |

## Correction made

The Contact snapshot previously omitted the service and budget dropdown choices.
Those values were present on the official page and have now been added under
`Contact form options`. The Contact snapshot's original source URL, extraction
timestamp, and source hash were preserved; its record content hash was
recalculated. No other snapshot content required correction.

The booking route resolves to:

https://bookings.cloud.microsoft/bookwithme/user/7a118ffd0485448da07ba8da90bc794b@zuigo.ai/meetingtype/UiV1LU0dEkqaxkNzBIToww2?anonymous&ismsaljsauthenabled&ep=mlink

## Scope notes

- Technology lists are published as representative, project-dependent stacks
  on the individual service pages. No separate general technology page was
  identified.
- Project examples are retained as examples described by ZuiGO, not as
  confirmed client engagements.
- The source SHA-256 values for all eight snapshots matched the bytes fetched
  from their source pages during this comparison. The external booking page is
  fetched from its resolved Microsoft URL; its appointment availability is not
  covered by static-page verification.
- All eight snapshots passed `scripts/validate_extraction.py` after the Contact
  correction.
