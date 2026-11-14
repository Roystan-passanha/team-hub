// Rules for the hub: project progress and health, action status, workload, what needs attention.
// Pure functions with no browser APIs, so they run in Node tests.

export const STAGES = [['planned', 'Planned'], ['active', 'In progress'], ['review', 'In review'], ['done', 'Done']];
export const HEALTH = { ok: 'On track', risk: 'At risk', late: 'Late', done: 'Done', planned: 'Not started' };

const DAY = 86400000;
const toDay = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
export const addDays = (iso, n) => new Date((toDay(iso) + n) * DAY).toISOString().slice(0, 10);
export const dayDiff = (a, b) => toDay(a) - toDay(b); // days from b to a
export function todayIso(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
/** Monday of the week the date falls in. */
export function weekStart(iso) { const d = new Date(iso + 'T00:00:00Z'); return addDays(iso, -((d.getUTCDay() + 6) % 7)); }

/** done | overdue | soon (due within 7 days) | later | nodate */
export function actionStatus(a, today) {
  if (a.done) return 'done';
  if (!a.due) return 'nodate';
  const d = dayDiff(a.due, today);
  return d < 0 ? 'overdue' : d <= 7 ? 'soon' : 'later';
}

/** Percent complete. With linked actions it is the share that are done; otherwise the figure typed in. */
export function projectProgress(p, actions) {
  if (p.stage === 'done') return 100;
  const mine = actions.filter(a => a.project === p.id);
  if (mine.length) return Math.round((mine.filter(a => a.done).length / mine.length) * 100);
  return Math.max(0, Math.min(100, Number(p.progress) || 0));
}

/**
 * Is a project on track? Returns { status, reason }.
 * Late: past its due date. At risk: an open blocker, overdue actions, or progress well behind the time used.
 */
export function projectHealth(p, state, today) {
  if (p.stage === 'done') return { status: 'done', reason: 'Finished' };
  if (p.due && dayDiff(p.due, today) < 0) return { status: 'late', reason: `Due date passed ${-dayDiff(p.due, today)} ${-dayDiff(p.due, today) === 1 ? 'day' : 'days'} ago` };
  const blockers = state.updates.filter(u => u.blocker && !u.blockerResolved && u.blockerProject === p.id).length;
  if (blockers) return { status: 'risk', reason: `${blockers} open ${blockers === 1 ? 'blocker' : 'blockers'}` };
  const overdue = state.actions.filter(a => a.project === p.id && actionStatus(a, today) === 'overdue').length;
  if (overdue) return { status: 'risk', reason: `${overdue} overdue ${overdue === 1 ? 'action' : 'actions'}` };
  if (p.start && dayDiff(p.start, today) > 0) return { status: 'planned', reason: `Starts in ${dayDiff(p.start, today)} ${dayDiff(p.start, today) === 1 ? 'day' : 'days'}` };
  if (p.start && p.due && dayDiff(p.due, p.start) > 0) {
    const used = Math.round((dayDiff(today, p.start) / dayDiff(p.due, p.start)) * 100);
    const progress = projectProgress(p, state.actions);
    if (used - progress > 20) return { status: 'risk', reason: `${progress}% done with ${used}% of the time used` };
  }
  if (p.stage === 'planned') return { status: 'planned', reason: 'Not started' };
  return { status: 'ok', reason: p.due ? `Due in ${dayDiff(p.due, today)} ${dayDiff(p.due, today) === 1 ? 'day' : 'days'}` : 'No due date' };
}

/** Open and overdue actions per person, busiest first. */
export function workload(state, today) {
  return state.people.map(person => {
    const mine = state.actions.filter(a => a.owner === person.id && !a.done);
    return { person, open: mine.length, overdue: mine.filter(a => actionStatus(a, today) === 'overdue').length };
  }).sort((a, b) => b.open - a.open);
}

/** People with no check-in for the given week. */
export function missingUpdates(state, week) {
  const posted = new Set(state.updates.filter(u => u.week === week).map(u => u.person));
  return state.people.filter(p => !posted.has(p.id));
}

/** Headline counts for the overview. */
export function summary(state, today) {
  const health = state.projects.map(p => projectHealth(p, state, today).status);
  const open = state.projects.filter(p => p.stage !== 'done').length;
  return {
    activeProjects: open,
    onTrack: health.filter(h => h === 'ok' || h === 'planned').length,
    atRisk: health.filter(h => h === 'risk').length,
    late: health.filter(h => h === 'late').length,
    overdueActions: state.actions.filter(a => actionStatus(a, today) === 'overdue').length,
    dueThisWeek: state.actions.filter(a => actionStatus(a, today) === 'soon').length,
    openBlockers: state.updates.filter(u => u.blocker && !u.blockerResolved).length,
    handoversWaiting: state.handovers.filter(h => !h.ackAt).length
  };
}

/** Everything that needs someone to do something, most urgent first. Each item: { kind, id, title, detail, rank }. */
export function attention(state, today) {
  const out = [];
  const name = id => (state.people.find(p => p.id === id) || { name: 'Unassigned' }).name;
  for (const p of state.projects) {
    const h = projectHealth(p, state, today);
    if (h.status === 'late') out.push({ kind: 'project', id: p.id, tone: 'late', title: p.name, detail: `Project late. ${h.reason}. Owner: ${name(p.owner)}`, rank: 0 });
    else if (h.status === 'risk') out.push({ kind: 'project', id: p.id, tone: 'risk', title: p.name, detail: `Project at risk. ${h.reason}. Owner: ${name(p.owner)}`, rank: 2 });
  }
  for (const u of state.updates) if (u.blocker && !u.blockerResolved) out.push({ kind: 'update', id: u.id, tone: 'risk', title: u.blocker, detail: `Blocker raised by ${name(u.person)}`, rank: 1 });
  for (const a of state.actions) if (actionStatus(a, today) === 'overdue') out.push({ kind: 'action', id: a.id, tone: 'late', title: a.title, detail: `Action overdue by ${-dayDiff(a.due, today)} ${-dayDiff(a.due, today) === 1 ? 'day' : 'days'}. Owner: ${name(a.owner)}`, rank: 3 });
  for (const h of state.handovers) if (!h.ackAt) out.push({ kind: 'handover', id: h.id, tone: 'info', title: h.title, detail: `Handover waiting for ${name(h.to)} to confirm`, rank: 4 });
  return out.sort((a, b) => a.rank - b.rank);
}

/** Check that imported data has the right shape. Returns an error message, or '' if it is fine. */
export function validate(data) {
  if (!data || typeof data !== 'object') return 'That file is not a Team Hub export.';
  for (const k of ['people', 'projects', 'actions', 'updates', 'handovers']) if (!Array.isArray(data[k])) return `That file is not a Team Hub export (no "${k}" list).`;
  const ok = (list, fields) => list.every(x => x && typeof x === 'object' && typeof x.id === 'string' && fields.every(f => typeof x[f] === 'string'));
  if (!ok(data.people, ['name']) || !ok(data.projects, ['name', 'stage']) || !ok(data.actions, ['title']) || !ok(data.updates, ['person', 'week']) || !ok(data.handovers, ['title'])) return 'That file is damaged: some entries are missing their name or id.';
  if (data.people.length > 500 || data.projects.length > 2000 || data.actions.length > 20000) return 'That file is too large to open here.';
  return '';
}

/** Sample workspace, dated around today so it never looks stale. */
export function sampleData(today) {
  const d = n => addDays(today, n), wk = weekStart(today), lastWk = addDays(wk, -7);
  const people = [['p1', 'Aisha Khan', 'Operations lead'], ['p2', 'Omar Ali', 'Sales'], ['p3', 'Priya Nair', 'Data analyst'], ['p4', 'John Smith', 'Finance'], ['p5', 'Sara Hassan', 'HR'], ['p6', 'Ravi Kumar', 'Logistics']]
    .map(([id, name, role]) => ({ id, name, role }));
  const projects = [
    { id: 'j1', name: 'New warehouse onboarding', owner: 'p6', team: 'Logistics', stage: 'active', start: d(-30), due: d(18), progress: 0, note: 'Third warehouse goes live on the shared delivery tracker.', log: [{ at: d(-3), who: 'p6', text: 'Racking installed. Scanner delivery confirmed for next week.' }, { at: d(-12), who: 'p1', text: 'Lease signed, access from the 1st.' }] },
    { id: 'j2', name: 'Monthly sales dashboard', owner: 'p3', team: 'Data', stage: 'review', start: d(-24), due: d(4), progress: 0, note: 'Replace the manual Excel pack with one dashboard for the sales meeting.', log: [{ at: d(-1), who: 'p3', text: 'Draft shared with Omar for review.' }] },
    { id: 'j3', name: 'Supplier payment clean-up', owner: 'p4', team: 'Finance', stage: 'active', start: d(-40), due: d(-3), progress: 70, note: 'Match open supplier invoices against statements before quarter end.', log: [{ at: d(-6), who: 'p4', text: 'Two suppliers still have not sent statements.' }] },
    { id: 'j4', name: 'HR records audit', owner: 'p5', team: 'HR', stage: 'active', start: d(-20), due: d(25), progress: 0, note: 'Check visa and passport expiry dates for all staff.', log: [] },
    { id: 'j5', name: 'Customer onboarding pack', owner: 'p2', team: 'Sales', stage: 'planned', start: d(6), due: d(40), progress: 0, note: 'One welcome pack and checklist for every new account.', log: [] },
    { id: 'j6', name: 'Delivery SLA report', owner: 'p3', team: 'Data', stage: 'done', start: d(-60), due: d(-14), progress: 100, note: 'Weekly on-time report by region.', log: [{ at: d(-14), who: 'p3', text: 'Signed off by operations.' }] },
    { id: 'j7', name: 'Returns process redesign', owner: 'p1', team: 'Operations', stage: 'active', start: d(-35), due: d(10), progress: 25, note: 'Cut the time from return request to refund.', log: [{ at: d(-8), who: 'p1', text: 'Mapped the current process with finance.' }] }
  ];
  const A = (id, title, owner, project, due, done = false) => ({ id, title, owner, project, due: due === null ? '' : d(due), done, doneAt: done ? d(Math.min(due, -1)) : '', note: '' });
  const actions = [
    A('a1', 'Confirm scanner delivery date', 'p6', 'j1', 2), A('a2', 'Train warehouse team on the tracker', 'p1', 'j1', 12), A('a3', 'Set up warehouse codes in the system', 'p3', 'j1', -6, true), A('a4', 'Sign access agreement', 'p1', 'j1', -15, true), A('a5', 'Test first inbound delivery', 'p6', 'j1', 16),
    A('a6', 'Review dashboard draft', 'p2', 'j2', 1), A('a7', 'Add region filter', 'p3', 'j2', -2, true), A('a8', 'Agree KPI definitions with finance', 'p4', 'j2', -8, true), A('a9', 'Present at sales meeting', 'p3', 'j2', 4),
    A('a10', 'Chase statements from two suppliers', 'p4', 'j3', -4), A('a11', 'Post correcting journals', 'p4', 'j3', -1),
    A('a12', 'Export staff list with document dates', 'p5', 'j4', -5, true), A('a13', 'Flag visas expiring in 90 days', 'p3', 'j4', 3), A('a14', 'Email affected staff', 'p5', 'j4', 9), A('a15', 'Book PRO appointments', 'p5', 'j4', 20),
    A('a16', 'Collect examples from top 5 accounts', 'p2', 'j5', 14),
    A('a17', 'Draft new returns form', 'p1', 'j7', -2), A('a18', 'Agree refund approval limit', 'p4', 'j7', 5),
    A('a19', 'Renew trade licence copy for bank', 'p4', '', 6), A('a20', 'Order laptops for two new joiners', 'p5', '', -1), A('a21', 'Update price list on shared drive', 'p2', '', null)
  ];
  const U = (id, person, week, done, next, blocker = '', blockerProject = '', resolved = false) => ({ id, person, week, done, next, blocker, blockerProject, blockerResolved: resolved, at: addDays(week, 1) });
  const updates = [
    U('u1', 'p6', wk, 'Racking installed at the new warehouse. Inbound route agreed with the carrier.', 'Receive scanners and run a test delivery.'),
    U('u2', 'p3', wk, 'Dashboard draft sent for review. Region filter added.', 'Fix review comments and prepare the sales meeting demo.'),
    U('u3', 'p4', wk, 'Matched 41 of 48 supplier accounts.', 'Close the remaining seven accounts.', 'Two suppliers have not sent statements, so their accounts cannot be closed.', 'j3'),
    U('u4', 'p1', wk, 'Mapped the returns process end to end.', 'Draft the new returns form.', 'Waiting for finance to confirm who can approve refunds above AED 2,000.', 'j7'),
    U('u5', 'p6', lastWk, 'Site survey done. Racking ordered.', 'Supervise racking installation.'),
    U('u6', 'p3', lastWk, 'Agreed KPI definitions with finance.', 'Build the first dashboard draft.'),
    U('u7', 'p5', lastWk, 'Exported the staff list with document dates.', 'Start checking visa expiry dates.', 'HR system export was missing passport numbers.', 'j4', true),
    U('u8', 'p2', lastWk, 'Closed three new accounts.', 'Review the sales dashboard draft.')
  ];
  const handovers = [
    { id: 'h1', title: 'Annual leave cover: supplier payments', from: 'p4', to: 'p1', start: d(3), end: d(12), open: 'Payment run on Thursday needs approval before 2 pm.\nTwo supplier statements still outstanding, chase on Monday.', watch: 'Bank token is in the finance safe. Do not release payments to new suppliers without a signed form.', createdAt: d(-1), ackAt: '', ackBy: '' },
    { id: 'h2', title: 'Night shift to day shift: warehouse', from: 'p6', to: 'p1', start: d(0), end: d(0), open: 'Three pallets for Abu Dhabi are staged at dock 2, collection at 9 am.\nForklift 2 is out of service, engineer booked for 11 am.', watch: 'Cold room alarm went off twice overnight. Temperature stayed in range.', createdAt: d(0), ackAt: '', ackBy: '' },
    { id: 'h3', title: 'Recruitment files for new joiners', from: 'p5', to: 'p3', start: d(-9), end: d(-5), open: 'Offer letters sent to both candidates.', watch: 'One candidate needs a visa transfer.', createdAt: d(-10), ackAt: d(-9), ackBy: 'p3' }
  ];
  const activity = [{ at: d(-1), who: 'p3', text: 'Moved "Monthly sales dashboard" to In review' }, { at: d(-1), who: 'p4', text: 'Created handover "Annual leave cover: supplier payments"' }, { at: d(-2), who: 'p3', text: 'Completed "Add region filter"' }];
  return { version: 1, name: 'Sample workspace', me: 'p1', people, projects, actions, updates, handovers, activity };
}
