# Team Hub

One page that shows a team where every project, action, weekly update and handover stands.

**Try it:** https://roystan-passanha.github.io/team-hub/

It opens with sample data so you can click around straight away. Use "Team and data" to start empty and add your own team.

## What it does

| Tab | Use it for |
| --- | --- |
| Overview | Counts of late and at-risk work, a "needs attention" list, progress per project, recent activity |
| Projects | Board (drag between stages), sortable list and timeline. Each project has an owner, dates, linked actions and progress notes |
| Actions | Tasks with an owner and due date, grouped into overdue, due in 7 days, later and done. Workload per person |
| Updates | Weekly check-in per person: finished, next, blockers. Shows who has not posted |
| Handovers | Shift and leave handovers that the person taking over has to confirm |

## How status is worked out

- **Late:** the due date has passed and the project is not done.
- **At risk:** there is an open blocker, an overdue action, or progress is more than 20 points behind the share of time used.
- **Percent complete:** the share of linked actions that are done. If a project has no actions, the number you type.

## Where the data lives

Everything is saved in your browser. Nothing is sent to a server.

That also means teammates do not see each other's changes live. To pass data on, use "Copy a share link" or "Export a file". The other person gets a copy. The storage code sits in `js/store.js` so a shared database can replace it later.

## Run it

No build step.

```
python3 -m http.server 8000
npm test
```

## Files

- `js/logic.js` status rules, workload, summary, sample data (tested)
- `js/store.js` saving, import, export, share links
- `js/app.js` screens and dialogs
- `tests/logic.test.js`

MIT licence.
