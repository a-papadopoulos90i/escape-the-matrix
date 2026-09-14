// Personal bridge between Levelix (in the browser) and Apple Reminders on this Mac.
// Run: node tools/reminders-bridge/server.mjs   — listens on 127.0.0.1 only; Levelix's
// "Sync with Reminders" button (opt-in with ?reminders=on) talks to it. No dependencies.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSync } from './plan.mjs';

const PORT = Number(process.env.LEVELIX_BRIDGE_PORT || 47827);
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reminders.jxa.js');
// What both sides agreed on at the last sync (see plan.mjs) — lets a change on either side win.
const STATE_FILE = process.env.LEVELIX_BRIDGE_STATE || path.join(homedir(), 'Library', 'Application Support', 'Levelix', 'reminders-bridge-state.json');
const ORIGINS = new Set([
  'https://levelix.eu',
  'https://www.levelix.eu',
  'https://levelix.web.app',
  'https://a-papadopoulos90i.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
const MAX_BODY = 5 * 1024 * 1024;

let queue = Promise.resolve(); // one sync or link at a time, start to finish
function exclusive(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

async function runJxa(command, payload) {
  const dir = await mkdtemp(path.join(tmpdir(), 'levelix-bridge-'));
  const file = path.join(dir, 'input.json');
  try {
    await writeFile(file, JSON.stringify(payload));
    const stdout = await new Promise((resolve, reject) => {
      execFile('osascript', ['-l', 'JavaScript', SCRIPT, command, file], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, out, err) =>
        error ? reject(new Error(err || error.message)) : resolve(out),
      );
    });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(`${STATE_FILE}.tmp`, JSON.stringify(state));
  await rename(`${STATE_FILE}.tmp`, STATE_FILE);
}

async function sync({ tasks = [], deleted = [], today }) {
  const state = await loadState();
  const reminders = await runJxa('read', {});
  const plan = planSync({ tasks, deleted, reminders, state, today });
  if (plan.ops.length) await runJxa('apply', { ops: plan.ops });
  await saveState(plan.state);
  return plan.result;
}

async function link({ links = [] }) {
  const result = await runJxa('link', { links });
  const state = await loadState();
  for (const { taskId, title, rDate = null, lDate } of links) state[taskId] = { title, rDate, lDate, placed: false };
  await saveState(state);
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed = origin && ORIGINS.has(origin) ? origin : null;
  if (origin && !allowed) return send(res, 403, { error: 'Origin not allowed' });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      Vary: 'Origin',
    });
    return res.end();
  }

  try {
    const { pathname } = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, list: 'Levelix', version: 2 }, allowed);
    if (req.method === 'POST' && (pathname === '/sync' || pathname === '/link')) {
      const payload = JSON.parse((await readBody(req)) || '{}');
      const result = await exclusive(() => (pathname === '/sync' ? sync(payload) : link(payload)));
      console.log(new Date().toISOString(), pathname, JSON.stringify(result).slice(0, 300));
      return send(res, 200, result, allowed);
    }
    return send(res, 404, { error: 'Not found' }, allowed);
  } catch (error) {
    console.error(new Date().toISOString(), error.message);
    return send(res, 500, { error: error.message }, allowed);
  }
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.log(`The bridge is already running on port ${PORT} — nothing to do. (To restart it, close the other one first.)`);
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Levelix ↔ Reminders bridge on http://127.0.0.1:${PORT} (list "Levelix"). Ctrl+C to stop.`);
});
