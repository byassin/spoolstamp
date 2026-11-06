// Local UI fixture only. No Bambu connection, credentials, emails or real printer reads.
// Run with: node tests/fixtures/ams-browser-preview.mjs
import { createServer } from 'node:http';

let scenario = 'ready';
let capturedAt = null;
let reads = 0;
const scenarios = ['ready', 'reading', 'fresh', 'expired', 'offline', 'outage'];
const slots = ['#000000FF', '#FFFFFFFF'].map((color, index) => ({
  key: `0:${index}`,
  unit: '0',
  slot: String(index),
  label: `A${index + 1}`,
  present: true,
  reading: false,
  material: 'PLA',
  productId: 'GFA00',
  color,
  colors: [color],
  remaining: 60,
}));
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3004');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type,x-spoolstamp-csrf',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const path = new URL(req.url, 'http://127.0.0.1:3005').pathname;
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      `<h1>Local AMS test fixture</h1><p>Scenario: ${scenario}</p><p>Simulated printer reads: ${reads}</p>${scenarios.map((name) => `<form action="/scenario/${name}" method="post"><button>${name}</button></form>`).join('')}`,
    );
    return;
  }
  if (req.method === 'POST' && path.startsWith('/scenario/')) {
    const next = path.slice('/scenario/'.length);
    if (!scenarios.includes(next)) {
      res.writeHead(400);
      res.end();
      return;
    }
    scenario = next;
    capturedAt =
      next === 'fresh'
        ? Date.now()
        : next === 'expired'
          ? Date.now() - 60_000
          : null;
    res.writeHead(303, { Location: '/' });
    res.end();
    return;
  }
  if (path === '/snapshot' && req.method === 'POST') {
    reads++;
    scenario = 'reading';
    setTimeout(() => {
      scenario = 'fresh';
      capturedAt = Date.now();
    }, 4000);
  } else if (path !== '/session' || req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (scenario === 'outage') {
    res.writeHead(503);
    res.end('{}');
    return;
  }
  res.end(
    JSON.stringify({
      csrf: 'a'.repeat(64),
      authenticated: true,
      codeRequested: false,
      expiresAt: Date.now() + 1_800_000,
      printers: [
        {
          serial: 'LOCALFIXTURE123',
          name: 'Sample printer',
          model: 'X2D',
          online: scenario !== 'offline',
        },
      ],
      selectedSerial: scenario === 'ready' ? null : 'LOCALFIXTURE123',
      pending: scenario === 'reading',
      refreshAfter: capturedAt ? capturedAt + 300_000 : 0,
      inventory: {
        available: true,
        connected: ['fresh', 'expired'].includes(scenario),
        printerName: 'Bambu Lab X2D',
        firmware: null,
        updatedAt: capturedAt,
        stale: scenario !== 'fresh',
        slots: capturedAt ? slots : [],
        message:
          scenario === 'offline'
            ? 'The printer is offline.'
            : 'Sign in to read your AMS.',
      },
    }),
  );
}).listen(3005, '127.0.0.1', () =>
  console.log('Synthetic AMS fixture: http://127.0.0.1:3005/'),
);
