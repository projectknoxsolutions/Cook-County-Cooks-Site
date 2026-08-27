# Cook County Cooks -- Tool Link Audit

Audited **37** tool entries from `tools.json` for the site launch.

- Broken / non-200 links: **1**
- Links that CANNOT be framed (X-Frame-Options / CSP frame-ancestors block): **1**

Rows flagged BROKEN or NOT FRAMEABLE are sorted to the top.

| slug | room | label | status | frameable | notes |
|---|---|---|---|---|---|
| `printouts` | office | Print Outs | 403 (Forbidden) :rotating_light: | no :no_entry: | SharePoint folder redirects (302) to a sign-in-gated OneDrive view, then returns 403 for unauthenticated access; requires an active Microsoft 365 session in a real browser. X-Frame-Options: SAMEORIGIN and CSP frame-ancestors allow only Microsoft/Teams/SharePoint domains -- cookcountycooks.com is NOT permitted, so this link can never be embedded in an iframe. Link itself is valid (tools.json already marks external_only:true) but must open in a new tab, not framed. |
| `accessory-order` | freezer | Accessory Order Form | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `bapis` | prep | Online Order Processing (BAPIS) | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `bp-access` | prep | Report BP Access Issues | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `brinks` | freezer | Brinks Pickup Log | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `chicago-remote-order` | freezer | Chicago Remote Order Form | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `commission-payouts` | host | Commission Payouts 2026 | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `credit-limit` | prep | Credit Limit Increase | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `daily-goals` | freezer | Daily Goal Sheet | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `daily-sales` | host | Daily Sales Report | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `discount-close` | pass | The Mobile Discount Close | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `employee-of-week` | breakroom | Head Chef Wall | LOCAL | n/a | local relative path, resolves inside site |
| `exception-report` | office | Exception Report | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `fall-off` | office | Fall-Off Summary | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `fox-run` | breakroom | C³ FOX RUN | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `interview-guide` | freezer | Interview Guides | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `missing-inventory` | freezer | Missing Inventory Scan | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `monday-ops` | freezer | Monday Ops Checklist | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `nps` | dining | NPS Report | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `open-orders` | freezer | Open Orders CRM | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `payment-reversal` | freezer | Payment Reversal | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `porting-guide` | prep | PortPro — Porting Guide | LOCAL | n/a | local relative path, resolves inside site |
| `price-tags` | freezer | Price Tags | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `punch-audit` | freezer | Auto Punch Compliance | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `quote-6th-gen` | pass | 6th Gen Mobile Quote Sheet | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `quote-internet` | pass | Internet Quote Sheet | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `quote-upgrade` | pass | Upgrade Quote Sheet | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `rally-call` | freezer | 3PM Rally Call | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `scorecards` | freezer | Employee Scorecards | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `target-planner` | freezer | Monthly Target Planner | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `training-straight-line` | breakroom | Sales Process 101 | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `training-tsheet` | breakroom | The Plus-First Playbook | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `training-xfinity` | breakroom | Xfinity Product Mastery | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `tsheet-submissions` | host | T-Sheet Submissions | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `wtw-big-south` | dining | Win the Weekend — Big South | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `wtw-chicago` | dining | Win the Weekend — Chicago | 200 | yes | no X-Frame-Options / frame-ancestors header found |
| `yesterdays-conversion` | host | Yesterday's Conversion | 200 | yes | no X-Frame-Options / frame-ancestors header found |
