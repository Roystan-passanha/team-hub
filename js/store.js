// Where the workspace lives. Today that is this browser's own storage.
// Everything goes through load / save, so a shared online database can replace it later
// without touching the rest of the app.
import { sampleData, todayIso, validate } from './logic.js';

const KEY = 'team-hub:v1';
let memory = null; // used when the browser blocks storage (private windows, strict settings)

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const data = JSON.parse(raw); if (!validate(data)) return normalise(data); }
  } catch (e) { /* fall through to memory or sample data */ }
  return memory || sampleData(todayIso());
}

/** Returns false when the browser would not keep the data. */
export function save(state) {
  memory = state;
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

export function normalise(data) {
  return { version: 1, name: data.name || 'Workspace', me: data.me || (data.people[0] && data.people[0].id) || '', activity: Array.isArray(data.activity) ? data.activity.slice(0, 60) : [],
    people: data.people, projects: data.projects.map(p => ({ log: [], progress: 0, team: '', note: '', start: '', due: '', owner: '', ...p })),
    actions: data.actions.map(a => ({ owner: '', project: '', due: '', done: false, doneAt: '', note: '', ...a })),
    updates: data.updates.map(u => ({ done: '', next: '', blocker: '', blockerProject: '', blockerResolved: false, at: '', ...u })),
    handovers: data.handovers.map(h => ({ from: '', to: '', start: '', end: '', open: '', watch: '', createdAt: '', ackAt: '', ackBy: '', ...h })) };
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

// ---- sharing a snapshot in a link: JSON -> gzip -> base64url, kept in the part of the address after # (never sent to a server)
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) { const out = new Response(new Blob([bytes]).stream().pipeThrough(stream)); return new Uint8Array(await out.arrayBuffer()); }

export async function encodeSnapshot(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return b64(await pipe(bytes, new CompressionStream('gzip')));
}
export async function decodeSnapshot(text) {
  const bytes = await pipe(unb64(text), new DecompressionStream('gzip'));
  if (bytes.length > 5e6) throw new Error('too large');
  return JSON.parse(new TextDecoder().decode(bytes));
}
