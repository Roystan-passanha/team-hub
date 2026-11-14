import { STAGES, HEALTH, todayIso, addDays, dayDiff, weekStart, actionStatus, projectProgress, projectHealth, workload, missingUpdates, summary, attention, validate, sampleData } from './logic.js';
import { load, save, uid, normalise, encodeSnapshot, decodeSnapshot } from './store.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k); return n; };
const TODAY = todayIso();
let state = load();
const ui = { view: 'overview', projectView: 'board', sort: { key: 'due', dir: 1 }, pf: { team: '', owner: '' }, af: { owner: '', project: '', show: 'open', q: '' }, week: weekStart(TODAY), hand: 'waiting' };

// ---------- small helpers ----------
const person = id => state.people.find(p => p.id === id);
const pname = id => (person(id) || { name: 'Unassigned' }).name;
const project = id => state.projects.find(p => p.id === id);
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function fmtDate(iso) {
  if (!iso) return 'No date';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(iso.slice(0, 4) !== TODAY.slice(0, 4) ? { year: 'numeric' } : {}) });
}
function dueText(iso) {
  if (!iso) return 'No date';
  const d = dayDiff(iso, TODAY);
  return d < -1 ? `${-d} days late` : d === -1 ? '1 day late' : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : d <= 7 ? `Due in ${d} days` : `Due ${fmtDate(iso)}`;
}
const who = id => el('span', { className: 'who' }, el('span', { className: 'avatar', textContent: initials(pname(id)), ariaHidden: 'true' }), el('span', { textContent: pname(id) }));
const pill = (tone, text) => el('span', { className: `pill pill--${tone}`, textContent: text });
const bar = (pct, tone = '') => { const i = el('i'); i.style.width = `${pct}%`; return el('div', { className: `bar ${tone ? 'bar--' + tone : ''}`, role: 'img', ariaLabel: `${pct}% complete` }, i); };
const options = (list, value, blank) => { const out = blank !== undefined ? [el('option', { value: '', textContent: blank })] : []; out.push(...list.map(([v, t]) => el('option', { value: v, textContent: t }))); return out; };
const select = (list, value, blank, props = {}) => { const s = el('select', props, ...options(list, value, blank)); s.value = value || ''; return s; };
const people = () => state.people.map(p => [p.id, p.name]);
const projects = () => state.projects.map(p => [p.id, p.name]);

let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600); }

/** Save, note what happened, redraw. */
function commit(text) {
  if (text) { state.activity.unshift({ at: TODAY, who: state.me, text }); state.activity = state.activity.slice(0, 60); }
  const kept = save(state);
  $('banner').hidden = kept;
  if (!kept) $('banner').textContent = 'This browser is not saving changes (this happens in some private windows). Use "Team and data" to export a file before you close the tab.';
  render();
}

// ---------- dialog ----------
const dlg = $('dlg');
function openDialog({ title, body, buttons }) {
  $('dlg-title').textContent = title;
  $('dlg-body').replaceChildren(...body);
  $('dlg-error').hidden = true;
  $('dlg-foot').replaceChildren(...buttons.map(b => {
    if (b === 'spacer') return el('span', { className: 'spacer' });
    const btn = el('button', { type: 'button', className: `btn ${b.kind ? 'btn--' + b.kind : ''}`, textContent: b.label });
    btn.addEventListener('click', () => { const r = b.onClick ? b.onClick(btn) : undefined; if (r !== false) dlg.close(); });
    return btn;
  }));
  if (!dlg.open) dlg.showModal();
}
const fail = text => { $('dlg-error').textContent = text; $('dlg-error').hidden = false; return false; };
const field = (label, input, hint) => el('label', { className: 'field' }, label, input, hint ? el('span', { className: 'hint', textContent: hint }) : null);
const text = (value, props = {}) => el('input', { type: 'text', value: value || '', ...props });
const date = value => el('input', { type: 'date', value: value || '' });
const area = (value, props = {}) => el('textarea', { value: value || '', ...props });
const pair = (a, b) => el('div', { className: 'field2' }, a, b);
$('dlg-x').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
$('dlg-form').addEventListener('submit', e => e.preventDefault());

// ---------- overview ----------
function viewOverview() {
  const s = summary(state, TODAY);
  const tile = (n, label, view, tone, set) => { const b = el('button', { className: `tile ${n && tone ? 'is-' + tone : ''}` }, el('span', { className: 'tile__n', textContent: n }), el('span', { className: 'tile__l', textContent: label })); b.addEventListener('click', () => { if (set) set(); go(view); }); return b; };
  const tiles = el('div', { className: 'tiles' },
    tile(s.activeProjects, 'Open projects', 'projects'), tile(s.onTrack, 'On track', 'projects', 'ok'), tile(s.atRisk, 'At risk', 'projects', 'risk'), tile(s.late, 'Late', 'projects', 'late'),
    tile(s.overdueActions, 'Overdue actions', 'actions', 'late'), tile(s.openBlockers, 'Open blockers', 'updates', 'risk'), tile(s.handoversWaiting, 'Handovers waiting', 'handovers', 'risk', () => { ui.hand = 'waiting'; }));

  const list = attention(state, TODAY);
  const open = { project: openProject, action: openAction, update: openUpdate, handover: openHandover };
  const need = el('section', { className: 'card' }, el('h2', { textContent: 'Needs attention' }),
    list.length ? el('div', { className: 'rows' }, ...list.slice(0, 12).map(x => { const r = el('button', { className: 'row' }, el('span', { className: 'row__t', textContent: x.title }), el('span', { className: 'row__d', textContent: x.detail }), el('span', { className: 'row__side' }, pill(x.tone, x.tone === 'late' ? 'Late' : x.tone === 'risk' ? 'At risk' : 'Waiting'))); r.addEventListener('click', () => open[x.kind](x.id)); return r; }))
      : el('p', { className: 'empty', textContent: 'Nothing is late, blocked or waiting. ' }),
    list.length > 12 ? el('p', { className: 'muted small', textContent: `And ${list.length - 12} more.` }) : null);

  const live = state.projects.filter(p => p.stage !== 'done').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const prog = el('section', { className: 'card' }, el('h2', { textContent: 'Project progress' }),
    live.length ? el('div', { className: 'rows' }, ...live.map(p => { const h = projectHealth(p, state, TODAY), pct = projectProgress(p, state.actions); const r = el('button', { className: 'row' }, el('span', { className: 'row__t', textContent: p.name }), el('span', { className: 'row__d' }, `${pct}% · ${h.reason}`, bar(pct, h.status)), el('span', { className: 'row__side' }, pill(h.status, HEALTH[h.status]))); r.addEventListener('click', () => openProject(p.id)); return r; }))
      : el('p', { className: 'empty', textContent: 'No open projects. Add one from the Projects tab.' }));

  const missing = missingUpdates(state, weekStart(TODAY));
  const week = el('section', { className: 'card' }, el('h2', { textContent: 'This week' }),
    el('p', { textContent: missing.length ? `${plural(state.people.length - missing.length, 'person has', 'people have')} posted an update. Still to post: ${missing.map(p => p.name).join(', ')}.` : 'Everyone has posted their update this week.' }),
    el('p', { className: 'muted', style: 'margin-top:6px', textContent: `${plural(s.dueThisWeek, 'action')} due in the next 7 days.` }));
  const feed = el('section', { className: 'card' }, el('h2', { textContent: 'Recent activity' }),
    state.activity.length ? el('ul', { className: 'log' }, ...state.activity.slice(0, 8).map(a => el('li', {}, el('div', { textContent: a.text }), el('div', { className: 'muted small', textContent: `${pname(a.who)} · ${fmtDate(a.at)}` })))) : el('p', { className: 'empty', textContent: 'Changes will be listed here.' }));
  return [tiles, el('div', { className: 'grid2' }, el('div', { className: 'stack' }, need, prog), el('div', { className: 'stack' }, week, feed))];
}

// ---------- projects ----------
function shownProjects() { return state.projects.filter(p => (!ui.pf.team || p.team === ui.pf.team) && (!ui.pf.owner || p.owner === ui.pf.owner)); }
function viewProjects() {
  const teams = [...new Set(state.projects.map(p => p.team).filter(Boolean))].sort().map(t => [t, t]);
  const seg = el('div', { className: 'seg', role: 'group', ariaLabel: 'View' }, ...[['board', 'Board'], ['list', 'List'], ['timeline', 'Timeline']].map(([v, t]) => { const b = el('button', { textContent: t, className: ui.projectView === v ? 'is-on' : '' }); b.setAttribute('aria-pressed', ui.projectView === v); b.addEventListener('click', () => { ui.projectView = v; render(); }); return b; }));
  const team = select(teams, ui.pf.team, 'All teams', { ariaLabel: 'Filter by team' }); team.addEventListener('change', () => { ui.pf.team = team.value; render(); });
  const owner = select(people(), ui.pf.owner, 'All owners', { ariaLabel: 'Filter by owner' }); owner.addEventListener('change', () => { ui.pf.owner = owner.value; render(); });
  $('toolbar').replaceChildren(seg, team, owner);
  const list = shownProjects();
  if (!state.projects.length) return [el('section', { className: 'card' }, el('p', { className: 'empty', textContent: 'No projects yet. Use "New project" to add the first one.' }))];
  return [ui.projectView === 'board' ? board(list) : ui.projectView === 'list' ? table(list) : timeline(list)];
}
function setStage(p, stage) {
  if (p.stage === stage) return;
  p.stage = stage;
  commit(`Moved "${p.name}" to ${STAGES.find(s => s[0] === stage)[1]}`);
}
function board(list) {
  return el('div', { className: 'board' }, ...STAGES.map(([stage, label]) => {
    const mine = list.filter(p => p.stage === stage);
    const col = el('section', { className: 'col', ariaLabel: label }, el('div', { className: 'col__h' }, el('span', { textContent: label }), el('span', { textContent: mine.length })),
      ...mine.map(p => {
        const h = projectHealth(p, state, TODAY), pct = projectProgress(p, state.actions);
        const c = el('button', { className: 'pcard', draggable: true }, el('span', { className: 'pcard__t', textContent: p.name }), el('span', {}, pill(h.status, HEALTH[h.status])), bar(pct, h.status),
          el('span', { className: 'pcard__m' }, who(p.owner), el('span', { textContent: stage === 'done' ? 'Done' : `${pct}% · ${p.due ? fmtDate(p.due) : 'No date'}` })));
        c.addEventListener('click', () => openProject(p.id));
        c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; });
        return c;
      }));
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('is-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('is-over'));
    col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('is-over'); const p = project(e.dataTransfer.getData('text/plain')); if (p) setStage(p, stage); });
    return col;
  }));
}
function table(list) {
  const cols = [['name', 'Project', p => p.name.toLowerCase()], ['owner', 'Owner', p => pname(p.owner)], ['team', 'Team', p => p.team], ['stage', 'Stage', p => STAGES.findIndex(s => s[0] === p.stage)],
    ['status', 'Status', p => ['late', 'risk', 'ok', 'planned', 'done'].indexOf(projectHealth(p, state, TODAY).status)], ['progress', 'Progress', p => projectProgress(p, state.actions)], ['due', 'Due', p => p.due || '9999']];
  const key = cols.find(c => c[0] === ui.sort.key)[2];
  const rows = [...list].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * ui.sort.dir);
  const head = el('tr', {}, ...cols.map(([k, t]) => { const b = el('button', { textContent: t + (ui.sort.key === k ? (ui.sort.dir > 0 ? ' ↑' : ' ↓') : '') }); b.addEventListener('click', () => { ui.sort = { key: k, dir: ui.sort.key === k ? -ui.sort.dir : 1 }; render(); }); return el('th', { scope: 'col' }, b); }));
  const body = rows.map(p => {
    const h = projectHealth(p, state, TODAY), pct = projectProgress(p, state.actions);
    const tr = el('tr', { tabIndex: 0 }, el('td', {}, el('strong', { textContent: p.name })), el('td', {}, who(p.owner)), el('td', { textContent: p.team }), el('td', { textContent: STAGES.find(s => s[0] === p.stage)[1] }),
      el('td', { title: h.reason }, pill(h.status, HEALTH[h.status])), el('td', { className: 'num' }, `${pct}%`, bar(pct, h.status)), el('td', { className: 'num', textContent: fmtDate(p.due) }));
    tr.addEventListener('click', () => openProject(p.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openProject(p.id); });
    return tr;
  });
  return el('section', { className: 'card tablewrap' }, el('table', {}, el('thead', {}, head), el('tbody', {}, ...body)), rows.length ? null : el('p', { className: 'empty', textContent: 'No projects match these filters.' }));
}
function timeline(list) {
  const dated = list.filter(p => p.start && p.due && p.due >= p.start).sort((a, b) => a.start.localeCompare(b.start));
  if (!dated.length) return el('section', { className: 'card' }, el('p', { className: 'empty', textContent: 'The timeline shows projects that have both a start and a due date.' }));
  let lo = dated.reduce((m, p) => (p.start < m ? p.start : m), TODAY), hi = dated.reduce((m, p) => (p.due > m ? p.due : m), TODAY);
  lo = addDays(lo, -3); hi = addDays(hi, 5);
  const span = dayDiff(hi, lo), at = iso => (dayDiff(iso, lo) / span) * 100;
  const ticks = [];
  for (let d = new Date(lo.slice(0, 8) + '01T00:00:00Z'); d.toISOString().slice(0, 10) <= hi; d.setUTCMonth(d.getUTCMonth() + 1)) { const iso = d.toISOString().slice(0, 10); if (iso >= lo) ticks.push(iso); }
  const scale = el('div', { className: 'gantt__scale' }, ...ticks.map(t => { const s = el('span', { textContent: new Date(t + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) }); s.style.left = at(t) + '%'; return s; }));
  const rows = dated.map(p => {
    const h = projectHealth(p, state, TODAY), pct = projectProgress(p, state.actions);
    const fill = el('i'); fill.style.width = pct + '%';
    const b = el('div', { className: `gantt__bar g-${h.status}`, title: `${fmtDate(p.start)} to ${fmtDate(p.due)} · ${pct}% · ${HEALTH[h.status]}` }, fill);
    b.style.left = at(p.start) + '%'; b.style.width = Math.max(0.8, at(p.due) - at(p.start)) + '%';
    const now = el('div', { className: 'gantt__today' }); now.style.left = at(TODAY) + '%';
    const name = el('button', { className: 'gantt__name', textContent: p.name, title: p.name }); name.addEventListener('click', () => openProject(p.id));
    return el('div', { className: 'gantt__row' }, name, el('div', { className: 'gantt__track' }, b, now));
  });
  return el('section', { className: 'card tablewrap' }, el('div', { className: 'gantt' }, el('div', { className: 'gantt__axis' }, el('span', { className: 'muted small', textContent: 'Blue line is today' }), scale), ...rows));
}

function openProject(id) {
  const p = project(id), isNew = !p;
  const d = p || { name: '', owner: state.me, team: '', stage: 'planned', start: TODAY, due: '', progress: 0, note: '', log: [] };
  const f = { name: text(d.name, { required: true }), owner: select(people(), d.owner, 'Unassigned'), team: text(d.team, { placeholder: 'For example Finance' }), stage: select(STAGES, d.stage), start: date(d.start), due: date(d.due), progress: el('input', { type: 'number', min: 0, max: 100, value: d.progress }), note: area(d.note) };
  const body = [field('Project name', f.name), pair(field('Owner', f.owner), field('Team', f.team)), pair(field('Stage', f.stage), field('Percent complete', f.progress)), pair(field('Start', f.start), field('Due', f.due)), field('What is it for?', f.note)];
  const live = el('div', { className: 'stack' });
  const drawLive = () => {
    const mine = state.actions.filter(a => a.project === p.id), h = projectHealth(p, state, TODAY), pct = projectProgress(p, state.actions);
    f.progress.disabled = mine.length > 0;
    if (mine.length) f.progress.value = pct;
    const add = text('', { placeholder: 'Add an action for this project', ariaLabel: 'New action' });
    const addBtn = el('button', { type: 'button', className: 'btn', textContent: 'Add' });
    const doAdd = () => { if (!add.value.trim()) return; state.actions.push({ id: uid(), title: add.value.trim(), owner: p.owner, project: p.id, due: '', done: false, doneAt: '', note: '' }); save(state); drawLive(); };
    addBtn.addEventListener('click', doAdd); add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    const note = text('', { placeholder: 'Write a short progress note', ariaLabel: 'New progress note' });
    const noteBtn = el('button', { type: 'button', className: 'btn', textContent: 'Post' });
    const doNote = () => { if (!note.value.trim()) return; p.log.unshift({ at: TODAY, who: state.me, text: note.value.trim() }); save(state); drawLive(); };
    noteBtn.addEventListener('click', doNote); note.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doNote(); } });
    live.replaceChildren(
      el('div', {}, el('p', { className: 'section-h', textContent: 'Status' }), el('p', {}, pill(h.status, HEALTH[h.status]), ` ${pct}% complete. ${h.reason}.`), mine.length ? el('p', { className: 'hint', textContent: `Percent complete is worked out from the ${plural(mine.length, 'action')} below.` }) : null),
      el('div', {}, el('p', { className: 'section-h', textContent: `Actions (${mine.filter(a => a.done).length} of ${mine.length} done)` }), ...mine.map(a => taskRow(a, drawLive, true)), el('div', { className: 'inline', style: 'margin-top:8px' }, add, addBtn)),
      el('div', {}, el('p', { className: 'section-h', textContent: 'Progress notes' }), el('div', { className: 'inline', style: 'margin:6px 0 10px' }, note, noteBtn),
        p.log.length ? el('ul', { className: 'log' }, ...p.log.map(l => el('li', {}, el('div', { textContent: l.text }), el('div', { className: 'muted small', textContent: `${pname(l.who)} · ${fmtDate(l.at)}` })))) : el('p', { className: 'muted small', textContent: 'No notes yet.' })));
  };
  if (!isNew) { drawLive(); body.push(live); }
  const saveIt = () => {
    if (!f.name.value.trim()) return fail('Give the project a name.');
    if (f.start.value && f.due.value && f.due.value < f.start.value) return fail('The due date is before the start date.');
    const next = { name: f.name.value.trim(), owner: f.owner.value, team: f.team.value.trim(), stage: f.stage.value, start: f.start.value, due: f.due.value, progress: Math.max(0, Math.min(100, Number(f.progress.value) || 0)), note: f.note.value.trim() };
    if (isNew) { state.projects.push({ id: uid(), log: [], ...next }); commit(`Created project "${next.name}"`); }
    else { const moved = p.stage !== next.stage; Object.assign(p, next); commit(moved ? `Moved "${p.name}" to ${STAGES.find(s => s[0] === p.stage)[1]}` : `Updated project "${p.name}"`); }
  };
  openDialog({ title: isNew ? 'New project' : d.name, body, buttons: [
    !isNew && { label: 'Delete', kind: 'danger', onClick: btn => { if (btn.dataset.sure) { state.projects = state.projects.filter(x => x.id !== p.id); state.actions.forEach(a => { if (a.project === p.id) a.project = ''; }); commit(`Deleted project "${p.name}"`); return true; } btn.dataset.sure = 1; btn.textContent = 'Click again to delete'; return false; } },
    'spacer', { label: 'Cancel', onClick: () => { render(); } }, { label: isNew ? 'Create project' : 'Save', kind: 'primary', onClick: saveIt }].filter(Boolean) });
}

// ---------- actions ----------
function toggleAction(a, done) { a.done = done; a.doneAt = done ? TODAY : ''; }
function taskRow(a, after, compact = false) {
  const st = actionStatus(a, TODAY);
  const box = el('input', { type: 'checkbox', checked: a.done, ariaLabel: `Mark "${a.title}" as done` });
  box.addEventListener('change', () => { toggleAction(a, box.checked); if (after) { save(state); after(); } else commit(box.checked ? `Completed "${a.title}"` : `Reopened "${a.title}"`); });
  const title = el('button', { type: 'button', className: 'task__t', textContent: a.title });
  title.addEventListener('click', () => openAction(a.id));
  const p = project(a.project);
  return el('div', { className: `task ${a.done ? 'is-done' : ''}` }, box, title, el('span', { className: `task__due ${st === 'overdue' ? 't-overdue' : st === 'soon' ? 't-soon' : 'muted'}`, textContent: a.done ? `Done ${fmtDate(a.doneAt)}` : dueText(a.due) }),
    el('span', { className: 'task__m' }, who(a.owner), !compact && p ? el('span', { textContent: p.name }) : null));
}
function viewActions() {
  const f = ui.af;
  const owner = select(people(), f.owner, 'Everyone', { ariaLabel: 'Filter by owner' }); owner.addEventListener('change', () => { f.owner = owner.value; render(); });
  const proj = select([...projects(), ['none', 'No project']], f.project, 'All projects', { ariaLabel: 'Filter by project' }); proj.addEventListener('change', () => { f.project = proj.value; render(); });
  const show = select([['open', 'Open'], ['all', 'Open and done'], ['done', 'Done']], f.show, undefined, { ariaLabel: 'Show' }); show.addEventListener('change', () => { f.show = show.value; render(); });
  const q = el('input', { type: 'search', placeholder: 'Search actions', value: f.q, ariaLabel: 'Search actions' });
  q.addEventListener('input', () => { f.q = q.value; const pos = q.selectionStart; render(); const again = $('toolbar').querySelector('input[type=search]'); again.focus(); again.setSelectionRange(pos, pos); });
  const mine = el('button', { className: 'btn', textContent: 'Only mine' }); mine.addEventListener('click', () => { f.owner = f.owner === state.me ? '' : state.me; render(); });
  $('toolbar').replaceChildren(owner, proj, show, q, mine);

  const list = state.actions.filter(a => (!f.owner || a.owner === f.owner) && (!f.project || (f.project === 'none' ? !a.project : a.project === f.project)) && (f.show === 'all' || (f.show === 'done') === a.done) && (!f.q || a.title.toLowerCase().includes(f.q.toLowerCase())));
  const groups = [['overdue', 'Overdue', 'late'], ['soon', 'Due in the next 7 days', 'risk'], ['later', 'Later', 'info'], ['nodate', 'No due date', 'planned'], ['done', 'Done', 'done']];
  const quickT = text('', { placeholder: 'Type an action and press Enter', ariaLabel: 'New action title' }), quickO = select(people(), state.me, 'Unassigned', { ariaLabel: 'Owner' }), quickD = date('');
  quickD.setAttribute('aria-label', 'Due date');
  const quick = () => { if (!quickT.value.trim()) return; state.actions.push({ id: uid(), title: quickT.value.trim(), owner: quickO.value, project: f.project && f.project !== 'none' ? f.project : '', due: quickD.value, done: false, doneAt: '', note: '' }); commit(`Added action "${quickT.value.trim()}"`); const t = $('view').querySelector('input[type=text]'); if (t) t.focus(); };
  quickT.addEventListener('keydown', e => { if (e.key === 'Enter') quick(); });
  const addBtn = el('button', { className: 'btn btn--primary', textContent: 'Add' }); addBtn.addEventListener('click', quick);
  const left = el('section', { className: 'card' }, el('div', { className: 'inline', style: 'margin-bottom:14px;flex-wrap:wrap' }, quickT, el('div', { className: 'inline' }, quickO, quickD, addBtn)),
    ...groups.flatMap(([k, label, tone]) => { const items = list.filter(a => actionStatus(a, TODAY) === k).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')); return items.length ? [el('div', { style: 'margin-top:14px' }, el('p', { className: 'group__h' }, pill(tone, label), `${items.length}`), ...items.map(a => taskRow(a)))] : []; }),
    list.length ? null : el('p', { className: 'empty', textContent: state.actions.length ? 'No actions match these filters.' : 'No actions yet. Type one above.' }));
  const w = workload(state, TODAY), max = Math.max(1, ...w.map(x => x.open));
  const right = el('section', { className: 'card' }, el('h2', { textContent: 'Workload' }), el('p', { className: 'muted small', textContent: 'Open actions per person.' }),
    ...w.map(x => el('div', { className: 'load' }, who(x.person.id), el('span', { className: x.overdue ? 't-overdue' : 'muted', textContent: x.overdue ? `${x.open} open, ${x.overdue} overdue` : `${x.open} open` }), bar(Math.round((x.open / max) * 100), x.overdue ? 'late' : ''))));
  return [el('div', { className: 'grid2' }, left, right)];
}
function openAction(id) {
  const a = state.actions.find(x => x.id === id), isNew = !a;
  const d = a || { title: '', owner: state.me, project: '', due: '', done: false, note: '' };
  const f = { title: text(d.title), owner: select(people(), d.owner, 'Unassigned'), project: select(projects(), d.project, 'No project'), due: date(d.due), note: area(d.note), done: el('input', { type: 'checkbox', checked: d.done }) };
  openDialog({ title: isNew ? 'New action' : 'Action', body: [field('What needs doing?', f.title), pair(field('Owner', f.owner), field('Due', f.due)), field('Project', f.project), field('Notes', f.note), el('label', { className: 'who' }, f.done, 'Done')],
    buttons: [!isNew && { label: 'Delete', kind: 'danger', onClick: () => { state.actions = state.actions.filter(x => x.id !== a.id); commit(`Deleted action "${a.title}"`); } }, 'spacer', { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: () => {
        if (!f.title.value.trim()) return fail('Say what needs doing.');
        const next = { title: f.title.value.trim(), owner: f.owner.value, project: f.project.value, due: f.due.value, note: f.note.value.trim() };
        if (isNew) { state.actions.push({ id: uid(), done: false, doneAt: '', ...next }); if (f.done.checked) toggleAction(state.actions[state.actions.length - 1], true); commit(`Added action "${next.title}"`); }
        else { const was = a.done; Object.assign(a, next); if (was !== f.done.checked) toggleAction(a, f.done.checked); commit(was !== f.done.checked ? (a.done ? `Completed "${a.title}"` : `Reopened "${a.title}"`) : `Updated action "${a.title}"`); }
      } }].filter(Boolean) });
}

// ---------- weekly updates ----------
function viewUpdates() {
  const prev = el('button', { className: 'btn', textContent: '← Earlier week' }); prev.addEventListener('click', () => { ui.week = addDays(ui.week, -7); render(); });
  const next = el('button', { className: 'btn', textContent: 'Later week →', disabled: ui.week >= weekStart(TODAY) }); next.addEventListener('click', () => { ui.week = addDays(ui.week, 7); render(); });
  $('toolbar').replaceChildren(prev, el('strong', { textContent: `Week of ${fmtDate(ui.week)}${ui.week === weekStart(TODAY) ? ' (this week)' : ''}` }), next);
  const list = state.updates.filter(u => u.week === ui.week);
  const blockerBox = u => { const p = project(u.blockerProject); const b = el('button', { className: 'btn btn--small', textContent: u.blockerResolved ? 'Reopen' : 'Mark resolved' }); b.addEventListener('click', () => { u.blockerResolved = !u.blockerResolved; commit(u.blockerResolved ? `Resolved a blocker raised by ${pname(u.person)}` : `Reopened a blocker raised by ${pname(u.person)}`); });
    return el('div', { className: `blocker ${u.blockerResolved ? 'is-resolved' : ''}` }, el('div', {}, el('strong', { textContent: u.blockerResolved ? 'Resolved: ' : 'Blocked: ' }), u.blocker, p ? el('div', { className: 'muted small', textContent: `Project: ${p.name}` }) : null), b); };
  const left = el('section', { className: 'card' }, ...(list.length ? list.map(u => { const edit = el('button', { className: 'btn btn--small', textContent: 'Edit' }); edit.addEventListener('click', () => openUpdate(u.id));
    return el('article', { className: 'update' }, el('div', { className: 'update__h' }, who(u.person), edit), el('dl', {}, el('dt', { textContent: 'Finished' }), el('dd', { textContent: u.done || 'Nothing listed' }), el('dt', { textContent: 'Next' }), el('dd', { textContent: u.next || 'Nothing listed' })), u.blocker ? blockerBox(u) : null); })
    : [el('p', { className: 'empty', textContent: 'Nobody has posted an update for this week yet.' })]));
  const missing = missingUpdates(state, ui.week);
  const open = state.updates.filter(u => u.blocker && !u.blockerResolved);
  const right = el('div', { className: 'stack' },
    el('section', { className: 'card' }, el('h2', { textContent: 'Not posted yet' }), missing.length ? el('div', {}, ...missing.map(p => el('div', { style: 'padding:5px 0' }, who(p.id)))) : el('p', { className: 'muted', textContent: 'Everyone has posted.' })),
    el('section', { className: 'card' }, el('h2', { textContent: 'Open blockers, all weeks' }), open.length ? el('div', { className: 'stack', style: 'gap:8px' }, ...open.map(u => el('div', {}, el('div', { className: 'muted small', textContent: `${pname(u.person)} · week of ${fmtDate(u.week)}` }), blockerBox(u)))) : el('p', { className: 'muted', textContent: 'No open blockers.' })));
  return [el('div', { className: 'grid2' }, left, right)];
}
function openUpdate(id) {
  const u = state.updates.find(x => x.id === id) || state.updates.find(x => x.person === state.me && x.week === ui.week && !id);
  const d = u || { person: state.me, done: '', next: '', blocker: '', blockerProject: '' };
  const f = { person: select(people(), d.person), done: area(d.done, { placeholder: 'What did you finish this week?' }), next: area(d.next, { placeholder: 'What are you doing next?' }), blocker: area(d.blocker, { placeholder: 'Leave empty if nothing is stopping you' }), proj: select(projects(), d.blockerProject, 'Not tied to a project') };
  openDialog({ title: `${u ? 'Edit' : 'Post'} update, week of ${fmtDate(u ? u.week : ui.week)}`, body: [field('Who', f.person), field('Finished', f.done), field('Next', f.next), field('Anything blocking you?', f.blocker, 'A blocker shows on the overview and marks the project as at risk until someone resolves it.'), field('Which project does the blocker affect?', f.proj)],
    buttons: [u && { label: 'Delete', kind: 'danger', onClick: () => { state.updates = state.updates.filter(x => x.id !== u.id); commit('Deleted an update'); } }, 'spacer', { label: 'Cancel' },
      { label: u ? 'Save' : 'Post update', kind: 'primary', onClick: () => {
        if (!f.done.value.trim() && !f.next.value.trim() && !f.blocker.value.trim()) return fail('Write something in at least one box.');
        if (!u && state.updates.some(x => x.person === f.person.value && x.week === ui.week)) return fail(`${pname(f.person.value)} has already posted for this week. Edit that update instead.`);
        const next = { person: f.person.value, done: f.done.value.trim(), next: f.next.value.trim(), blocker: f.blocker.value.trim(), blockerProject: f.blocker.value.trim() ? f.proj.value : '' };
        if (u) { if (u.blocker !== next.blocker) u.blockerResolved = false; Object.assign(u, next); commit(`${pname(u.person)} edited their weekly update`); }
        else { state.updates.unshift({ id: uid(), week: ui.week, blockerResolved: false, at: TODAY, ...next }); commit(`${pname(next.person)} posted a weekly update`); }
      } }].filter(Boolean) });
}

// ---------- handovers ----------
function viewHandovers() {
  const seg = el('div', { className: 'seg', role: 'group', ariaLabel: 'Show' }, ...[['waiting', 'Waiting'], ['all', 'All']].map(([v, t]) => { const b = el('button', { textContent: t, className: ui.hand === v ? 'is-on' : '' }); b.setAttribute('aria-pressed', ui.hand === v); b.addEventListener('click', () => { ui.hand = v; render(); }); return b; }));
  $('toolbar').replaceChildren(seg);
  const list = state.handovers.filter(h => ui.hand === 'all' || !h.ackAt).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!list.length) return [el('section', { className: 'card' }, el('p', { className: 'empty', textContent: state.handovers.length ? 'Every handover has been confirmed. Choose "All" to see past ones.' : 'No handovers yet. Use "New handover" before a shift change or leave.' }))];
  return [el('div', { className: 'stack' }, ...list.map(h => {
    const edit = el('button', { className: 'btn btn--small', textContent: 'Edit' }); edit.addEventListener('click', () => openHandover(h.id));
    let foot;
    if (h.ackAt) foot = el('span', {}, pill('ok', 'Confirmed'), ` ${pname(h.ackBy)} confirmed on ${fmtDate(h.ackAt)}`);
    else if (h.to === state.me) { const b = el('button', { className: 'btn btn--primary', textContent: "Confirm I've read this" }); b.addEventListener('click', () => { h.ackAt = TODAY; h.ackBy = state.me; commit(`${pname(state.me)} confirmed handover "${h.title}"`); }); foot = b; }
    else foot = el('span', {}, pill('risk', 'Waiting'), ` Waiting for ${pname(h.to)}. Only ${pname(h.to)} can confirm it.`);
    return el('article', { className: 'card hand' }, el('div', { className: 'hand__h' }, el('div', {}, el('h2', { textContent: h.title }), el('div', { className: 'hand__route' }, who(h.from), '→', who(h.to), h.start ? `· ${fmtDate(h.start)}${h.end && h.end !== h.start ? ' to ' + fmtDate(h.end) : ''}` : '')), edit),
      el('div', {}, el('h3', { textContent: 'Open items' }), el('pre', { textContent: h.open || 'None listed' })), el('div', {}, el('h3', { textContent: 'Watch out for' }), el('pre', { textContent: h.watch || 'Nothing listed' })), el('div', { className: 'hand__foot' }, foot));
  }))];
}
function openHandover(id) {
  const h = state.handovers.find(x => x.id === id), isNew = !h;
  const d = h || { title: '', from: state.me, to: '', start: TODAY, end: '', open: '', watch: '' };
  const f = { title: text(d.title, { placeholder: 'For example Leave cover: payroll' }), from: select(people(), d.from), to: select(people(), d.to, 'Choose who takes over'), start: date(d.start), end: date(d.end), open: area(d.open, { placeholder: 'One item per line' }), watch: area(d.watch) };
  openDialog({ title: isNew ? 'New handover' : 'Edit handover', body: [field('Title', f.title), pair(field('From', f.from), field('To', f.to)), pair(field('Starts', f.start), field('Ends', f.end)), field('Open items', f.open), field('Watch out for', f.watch)],
    buttons: [!isNew && { label: 'Delete', kind: 'danger', onClick: () => { state.handovers = state.handovers.filter(x => x.id !== h.id); commit(`Deleted handover "${h.title}"`); } }, 'spacer', { label: 'Cancel' },
      { label: isNew ? 'Create handover' : 'Save', kind: 'primary', onClick: () => {
        if (!f.title.value.trim()) return fail('Give the handover a title.');
        if (!f.to.value) return fail('Choose who is taking over.');
        if (f.to.value === f.from.value) return fail('Choose two different people.');
        const next = { title: f.title.value.trim(), from: f.from.value, to: f.to.value, start: f.start.value, end: f.end.value, open: f.open.value.trim(), watch: f.watch.value.trim() };
        if (isNew) { state.handovers.push({ id: uid(), createdAt: TODAY, ackAt: '', ackBy: '', ...next }); commit(`Created handover "${next.title}"`); }
        else { const changed = h.open !== next.open || h.watch !== next.watch || h.to !== next.to; Object.assign(h, next); if (changed) { h.ackAt = ''; h.ackBy = ''; } commit(`Updated handover "${h.title}"`); } // a changed handover must be read again
      } }].filter(Boolean) });
}

// ---------- team and data ----------
function download(name, textContent) { const a = el('a', { href: URL.createObjectURL(new Blob([textContent], { type: 'application/json' })), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
const exportFile = () => download(`team-hub-${TODAY}.json`, JSON.stringify(state, null, 2));
function openTeam() {
  const name = text(state.name);
  const rows = el('ul', { className: 'log people' });
  const draft = state.people.map(p => ({ ...p }));
  const draw = () => rows.replaceChildren(...draft.map((p, i) => { const n = text(p.name, { ariaLabel: 'Name' }), r = text(p.role, { ariaLabel: 'Role', placeholder: 'Role' }); n.addEventListener('input', () => { p.name = n.value; }); r.addEventListener('input', () => { p.role = r.value; });
    const x = el('button', { type: 'button', className: 'btn btn--small', textContent: 'Remove' }); x.addEventListener('click', () => { draft.splice(i, 1); draw(); }); return el('li', {}, n, r, x); }));
  draw();
  const add = el('button', { type: 'button', className: 'btn', textContent: 'Add a person' }); add.addEventListener('click', () => { draft.push({ id: uid(), name: '', role: '' }); draw(); rows.lastChild.querySelector('input').focus(); });
  const b = (label, fn, kind = '') => { const x = el('button', { type: 'button', className: `btn ${kind}`, textContent: label }); x.addEventListener('click', () => fn(x)); return x; };
  const data = el('div', { className: 'inline', style: 'flex-wrap:wrap' },
    b('Export a file', exportFile), b('Import a file', () => $('import-file').click()),
    b('Copy a share link', async () => { try { const link = `${location.origin}${location.pathname}#data=${await encodeSnapshot(state)}`; await navigator.clipboard.writeText(link); toast(link.length > 6000 ? 'Link copied. It is long, so some chat apps may cut it. Send the exported file if it does not open.' : 'Link copied. Anyone who opens it gets a copy of this workspace.'); } catch (e) { toast('Could not copy a link in this browser. Export a file instead.'); } }),
    b('Load sample data', x => { if (!x.dataset.sure) { x.dataset.sure = 1; x.textContent = 'Click again: replaces everything'; return; } state = sampleData(TODAY); dlg.close(); commit(''); toast('Sample data loaded.'); }),
    b('Start empty', x => { if (!x.dataset.sure) { x.dataset.sure = 1; x.textContent = 'Click again: erases everything'; return; } state = normalise({ name: 'My team', people: [{ id: uid(), name: 'Me', role: '' }], projects: [], actions: [], updates: [], handovers: [] }); dlg.close(); commit(''); toast('Workspace cleared. Add your team under "Team and data".'); }, 'btn--danger'));
  openDialog({ title: 'Team and data', body: [field('Workspace name', name), el('div', {}, el('p', { className: 'section-h', textContent: 'People' }), rows, el('div', { style: 'margin-top:8px' }, add)),
    el('div', {}, el('p', { className: 'section-h', textContent: 'Data' }), el('p', { className: 'muted small', style: 'margin:4px 0 10px', textContent: 'Everything is saved in this browser only. To give teammates the same data, send them a share link or an exported file. Their changes will not come back to you automatically.' }), data)],
    buttons: ['spacer', { label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: () => {
      const kept = draft.filter(p => p.name.trim()).map(p => ({ ...p, name: p.name.trim(), role: (p.role || '').trim() }));
      if (!kept.length) return fail('Keep at least one person.');
      const ids = new Set(kept.map(p => p.id)), gone = id => (ids.has(id) ? id : '');
      state.projects.forEach(p => { p.owner = gone(p.owner); }); state.actions.forEach(a => { a.owner = gone(a.owner); });
      state.updates = state.updates.filter(u => ids.has(u.person)); state.handovers = state.handovers.filter(h => ids.has(h.from) && ids.has(h.to));
      state.people = kept; state.name = name.value.trim() || 'Workspace'; if (!ids.has(state.me)) state.me = kept[0].id;
      commit('');
    } }] });
}
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try { const data = JSON.parse(await file.text()); const problem = validate(data); if (problem) return toast(problem); state = normalise(data); if (dlg.open) dlg.close(); commit(''); toast('File imported.'); }
  catch (err) { toast('That file could not be read. Choose a file exported from Team Hub.'); }
});
async function openShared() {
  if (!location.hash.startsWith('#data=')) return;
  const code = location.hash.slice(6);
  history.replaceState(null, '', location.pathname + location.search);
  let data;
  try { data = await decodeSnapshot(code); if (validate(data)) throw new Error('shape'); } catch (e) { return toast('That share link is damaged or incomplete. Ask for an exported file instead.'); }
  openDialog({ title: 'Open a shared workspace?', body: [el('p', { textContent: `This link holds "${data.name || 'Workspace'}": ${plural(data.projects.length, 'project')}, ${plural(data.actions.length, 'action')} and ${plural(data.people.length, 'person', 'people')}.` }), el('p', { className: 'muted', textContent: 'Opening it replaces the data saved in this browser. Export your current data first if you want to keep it.' })],
    buttons: [{ label: 'Export my current data', onClick: () => { exportFile(); return false; } }, 'spacer', { label: 'Cancel' }, { label: 'Open it', kind: 'primary', onClick: () => { state = normalise(data); commit(''); toast('Shared workspace opened.'); } }] });
}

// ---------- shell ----------
const VIEWS = {
  overview: { title: () => state.name, sub: () => `Where everything stands on ${new Date(TODAY + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}.`, draw: viewOverview },
  projects: { title: () => 'Projects', sub: () => 'Every project, who owns it and whether it is on track.', draw: viewProjects, add: ['New project', () => openProject()] },
  actions: { title: () => 'Actions', sub: () => 'Tasks and meeting actions with an owner and a due date.', draw: viewActions, add: ['New action', () => openAction()] },
  updates: { title: () => 'Weekly updates', sub: () => 'What each person finished, what is next and what is blocking them.', draw: viewUpdates, add: ['Post my update', () => openUpdate()] },
  handovers: { title: () => 'Handovers', sub: () => 'Shift and leave handovers, confirmed by the person taking over.', draw: viewHandovers, add: ['New handover', () => openHandover()] }
};
function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }
function render() {
  const v = VIEWS[ui.view], s = summary(state, TODAY);
  for (const t of document.querySelectorAll('.tab')) { const on = t.dataset.view === ui.view; t.classList.toggle('is-on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
  $('n-projects').textContent = s.late + s.atRisk || ''; $('n-actions').textContent = s.overdueActions || ''; $('n-updates').textContent = s.openBlockers || ''; $('n-handovers').textContent = s.handoversWaiting || '';
  $('title').textContent = v.title(); $('subtitle').textContent = v.sub();
  document.title = `${v.title()} · Team Hub`;
  const me = $('me'); me.replaceChildren(...options(people())); me.value = state.me;
  $('toolbar').replaceChildren();
  $('head-actions').replaceChildren(...(v.add ? [(() => { const b = el('button', { className: 'btn btn--primary', textContent: v.add[0] }); b.addEventListener('click', v.add[1]); return b; })()] : []));
  $('view').replaceChildren(...v.draw());
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => go(t.dataset.view));
$('me').addEventListener('change', () => { state.me = $('me').value; save(state); render(); });
$('btn-team').addEventListener('click', openTeam);
function theme(mode) { document.documentElement.dataset.theme = mode; $('btn-theme').textContent = mode === 'light' ? 'Dark mode' : 'Light mode'; try { localStorage.setItem('team-hub:theme', mode); } catch (e) { /* not saved, still applied */ } }
$('btn-theme').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
let saved = 'dark'; try { saved = localStorage.getItem('team-hub:theme') || 'dark'; } catch (e) { /* default */ }
theme(saved);
render();
openShared();
