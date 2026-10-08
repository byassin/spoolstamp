// Credential-free HTTPS smoke test. --preview creates/deletes one anonymous
// session; it never requests a Bambu email, authenticates, or opens MQTT.
const origin = 'https://ams.spoolstamp.bourhan.org';
const app = 'https://spoolstamp.bourhan.org';
const preview = process.argv.slice(2).includes('--preview');
if (process.argv.slice(2).some((arg) => arg !== '--preview'))
  throw new Error('Use no arguments or --preview.');
let cookie = '';
let csrf = '';
async function request(path, method = 'GET', headers = {}, body) {
  return fetch(origin + path, {
    method,
    redirect: 'error',
    cache: 'no-store',
    headers: { Origin: app, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
}
function check(condition, label) {
  if (!condition) throw new Error(`${label} failed.`);
  console.log(`${label}: PASS`);
}
try {
  const health = await request('/healthz');
  check(
    health.status === 200 && (await health.json()).ok === true,
    'Verified HTTPS health',
  );
  if (!preview) {
    const response = await request('/session');
    check(response.status === 503, 'Disabled session endpoint fails closed');
  } else {
    const response = await request('/session');
    check(response.status === 200, 'Anonymous session bootstrap');
    const setCookie = response.headers.get('set-cookie') ?? '';
    cookie = setCookie.split(';')[0];
    const state = await response.json();
    csrf = state.csrf;
    check(
      /^__Host-spoolstamp-cloud=[a-f0-9]{64};/.test(setCookie) &&
        /HttpOnly/.test(setCookie) &&
        /Secure/.test(setCookie) &&
        /SameSite=Strict/.test(setCookie) &&
        !/Domain=/i.test(setCookie),
      'Host-only secure cookie',
    );
    check(
      response.headers.get('access-control-allow-origin') === app &&
        response.headers.get('access-control-allow-credentials') === 'true' &&
        response.headers.get('cache-control') === 'no-store',
      'Exact credentialed CORS and no-store',
    );
    check(
      typeof csrf === 'string' &&
        /^[a-f0-9]{64}$/.test(csrf) &&
        !state.authenticated &&
        !state.codeRequested,
      'Sanitized unauthenticated contract',
    );
    const repeated = await request('/session');
    const repeatedState = await repeated.json();
    check(
      repeated.status === 200 &&
        repeatedState.csrf === csrf &&
        repeatedState.expiresAt === state.expiresAt,
      'Cross-request session persistence without sliding expiry',
    );
    const badOrigin = await request('/session', 'GET', {
      Origin: 'https://unrelated.example.org',
    });
    check(
      badOrigin.status === 403 &&
        badOrigin.headers.get('access-control-allow-origin') === null,
      'Unrelated origin rejected',
    );
    const preflight = await request('/login', 'OPTIONS', {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-spoolstamp-csrf',
    });
    check(
      preflight.status === 204 &&
        preflight.headers.get('access-control-allow-origin') === app,
      'Browser preflight',
    );
    const badCsrf = await request('/session', 'DELETE');
    check(badCsrf.status === 403, 'Missing CSRF rejected');
    const loggedOut = await request('/session', 'DELETE', {
      'X-Spoolstamp-CSRF': csrf,
    });
    check(
      loggedOut.status === 200 &&
        /Max-Age=0/.test(loggedOut.headers.get('set-cookie') ?? ''),
      'Logout deletes session and clears cookie',
    );
    csrf = '';
    const afterLogout = await request(
      '/snapshot',
      'POST',
      {
        'Content-Type': 'application/json',
        'X-Spoolstamp-CSRF': repeatedState.csrf,
      },
      { serial: 'SYNTHETICPRINTER123' },
    );
    check(afterLogout.status === 401, 'Deleted session cannot read a printer');
    cookie = '';
  }
  console.log(
    'No Bambu credentials, email requests, or printer reads were used.',
  );
} catch {
  console.error(
    'AMS deployment smoke test failed. Inspect infrastructure/configuration without logging payloads or credentials.',
  );
  process.exitCode = 1;
} finally {
  if (cookie && csrf)
    await request('/session', 'DELETE', { 'X-Spoolstamp-CSRF': csrf }).catch(
      () => undefined,
    );
}
