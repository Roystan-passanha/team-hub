import test from 'node:test';
import assert from 'node:assert/strict';
import { actionStatus, projectProgress, projectHealth, workload, missingUpdates, summary, attention, validate, sampleData, weekStart, addDays, dayDiff } from '../js/logic.js';

const T = '2026-11-18'; // a Wednesday
const empty = () => ({ people: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], projects: [], actions: [], updates: [], handovers: [] });

test('dates', () => {
  assert.equal(weekStart(T), '2026-11-16');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday belongs to the week that started Monday
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(dayDiff('2026-11-20', T), 2);
});

test('action status', () => {
  assert.equal(actionStatus({ due: '2026-11-17' }, T), 'overdue');
  assert.equal(actionStatus({ due: T }, T), 'soon'); // due today is not overdue yet
  assert.equal(actionStatus({ due: '2026-11-25' }, T), 'soon');
  assert.equal(actionStatus({ due: '2026-11-26' }, T), 'later');
  assert.equal(actionStatus({ due: '' }, T), 'nodate');
  assert.equal(actionStatus({ due: '2026-01-01', done: true }, T), 'done');
});

test('project progress comes from linked actions when there are any', () => {
  const p = { id: 'j', stage: 'active', progress: 40 };
  assert.equal(projectProgress(p, []), 40);
  assert.equal(projectProgress(p, [{ project: 'j', done: true }, { project: 'j', done: false }, { project: 'j', done: false }, { project: 'x', done: true }]), 33);
  assert.equal(projectProgress({ ...p, stage: 'done' }, []), 100);
  assert.equal(projectProgress({ ...p, progress: 400 }, []), 100);
});

test('project health', () => {
  const s = empty();
  const base = { id: 'j', stage: 'active', start: '2026-11-01', due: '2026-12-01', progress: 60 };
  assert.equal(projectHealth(base, s, T).status, 'ok');
  assert.equal(projectHealth({ ...base, due: '2026-11-10' }, s, T).status, 'late');
  assert.equal(projectHealth({ ...base, stage: 'done', due: '2026-11-10' }, s, T).status, 'done');
  assert.equal(projectHealth({ ...base, progress: 10 }, s, T).status, 'risk'); // 57% of time used, 10% done
  assert.equal(projectHealth({ ...base, start: '2026-11-25' }, s, T).status, 'planned');
  s.actions.push({ project: 'j', due: '2026-11-10', done: false }, { project: 'j', due: '2026-11-30', done: true }, { project: 'j', due: '2026-11-30', done: true });
  assert.match(projectHealth(base, s, T).reason, /1 overdue action$/);
  s.updates.push({ blocker: 'stuck', blockerProject: 'j', blockerResolved: false });
  assert.match(projectHealth(base, s, T).reason, /1 open blocker/);
  s.updates[0].blockerResolved = true;
  assert.match(projectHealth(base, s, T).reason, /overdue/);
});

test('sample workspace is consistent and covers every state', () => {
  const s = sampleData(T);
  assert.equal(validate(s), '');
  const ids = new Set(s.people.map(p => p.id)), pj = new Set(s.projects.map(p => p.id));
  assert.ok(s.projects.every(p => ids.has(p.owner)));
  assert.ok(s.actions.every(a => ids.has(a.owner) && (a.project === '' || pj.has(a.project))));
  const statuses = new Set(s.projects.map(p => projectHealth(p, s, T).status));
  for (const st of ['ok', 'risk', 'late', 'done', 'planned']) assert.ok(statuses.has(st), st);
  const sum = summary(s, T);
  assert.equal(sum.activeProjects, 6);
  assert.equal(sum.overdueActions, s.actions.filter(a => !a.done && a.due && a.due < T).length);
  assert.equal(sum.openBlockers, 2);
  assert.equal(sum.handoversWaiting, 2);
  assert.equal(sum.onTrack + sum.atRisk + sum.late, 6);
});

test('workload, missing check-ins and the attention list', () => {
  const s = sampleData(T);
  const w = workload(s, T);
  assert.equal(w.reduce((a, x) => a + x.open, 0), s.actions.filter(a => !a.done).length);
  assert.ok(w[0].open >= w[1].open);
  assert.deepEqual(missingUpdates(s, weekStart(T)).map(p => p.id).sort(), ['p2', 'p5']);
  const list = attention(s, T);
  assert.equal(list[0].tone, 'late');
  assert.equal(list[0].kind, 'project');
  assert.ok(list.some(x => x.kind === 'handover') && list.some(x => x.kind === 'action') && list.some(x => x.kind === 'update'));
  assert.deepEqual(list.map(x => x.rank), [...list.map(x => x.rank)].sort((a, b) => a - b));
  assert.equal(attention(empty(), T).length, 0);
});

test('import is checked', () => {
  assert.notEqual(validate(null), '');
  assert.notEqual(validate({ people: [] }), '');
  assert.notEqual(validate({ ...empty(), projects: [{ id: 'x' }] }), '');
  assert.equal(validate(empty()), '');
});
