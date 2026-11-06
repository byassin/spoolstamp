'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { createHostedAmsClient } from '../lib/cloud-ams-client';
import type { HostedCloudState } from '../lib/cloud-ams';
import type { AmsInventory } from '../lib/ams';
import { PRINTERS } from '../lib/catalog';
import { cloudPollDelay, formatReadWait } from '../lib/ams-freshness';
import { AmsConnectionStatus } from './ams-connection-status';

export function CloudAmsConnection({
  origin,
  onInventory,
  hasLabelChoices = false,
}: {
  origin: string;
  onInventory: (value: AmsInventory | null) => void;
  hasLabelChoices?: boolean;
}) {
  const [state, setState] = useState<HostedCloudState | null>(null);
  const [started, setStarted] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [printer, setPrinter] = useState('');
  const selectedPrinter = useRef('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const client = useRef<ReturnType<typeof createHostedAmsClient> | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const working = useRef(false);
  const callback = useRef(onInventory);
  useLayoutEffect(() => {
    callback.current = onInventory;
  }, [onInventory]);
  function accept(value: HostedCloudState) {
    setUnavailable(false);
    setError((previous) =>
      previous ===
      'Cloud service unavailable. Check the connection or use the manual picker.'
        ? ''
        : previous,
    );
    setState(value);
    setClock(Date.now());
    const model = value.printers.find(
      (item) => item.serial === value.selectedSerial,
    )?.model;
    const profile = PRINTERS.find(
      (item) => item.name === model || item.fullName === model,
    );
    const chosen = !value.authenticated
      ? ''
      : value.printers.some((item) => item.serial === selectedPrinter.current)
        ? selectedPrinter.current
        : value.printers.some((item) => item.serial === value.selectedSerial)
          ? value.selectedSerial!
          : value.printers.length === 1
            ? value.printers[0].serial
            : '';
    selectedPrinter.current = chosen;
    setPrinter(chosen);
    callback.current(
      value.selectedSerial === chosen
        ? {
            ...value.inventory,
            printerName: profile?.fullName ?? value.inventory.printerName,
          }
        : null,
    );
  }
  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    lifecycle.current = controller;
    const connection = createHostedAmsClient(origin);
    client.current = connection;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    async function poll() {
      const version = revision.current;
      try {
        if (!working.current) {
          const value = await connection.read(controller.signal);
          if (!controller.signal.aborted && version === revision.current) {
            failures = 0;
            accept(value);
          }
        }
      } catch {
        if (!controller.signal.aborted && version === revision.current) {
          callback.current(null);
          failures++;
          setUnavailable(true);
          setError(
            'Cloud service unavailable. Check the connection or use the manual picker.',
          );
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(poll, cloudPollDelay(failures));
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(clockTimer);
      client.current = null;
    };
  }, [origin, started, retry]);
  async function action(
    operation: (
      connection: ReturnType<typeof createHostedAmsClient>,
      signal: AbortSignal,
    ) => Promise<HostedCloudState | null>,
  ) {
    const connection = client.current;
    const controller = lifecycle.current;
    if (!connection || !controller || working.current) return;
    working.current = true;
    revision.current++;
    setBusy(true);
    setError('');
    try {
      const value = await operation(connection, controller.signal);
      if (controller.signal.aborted) return;
      if (value) accept(value);
      else {
        setState(null);
        setPrinter('');
        selectedPrinter.current = '';
        setEmail('');
        setCode('');
        setConsent(false);
        callback.current(null);
        setStarted(false);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : 'Cloud connection failed.',
        );
        callback.current(null);
      }
    } finally {
      working.current = false;
      revision.current++;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const wait = Math.max(
    0,
    Math.ceil(((state?.refreshAfter ?? 0) - clock) / 1000),
  );
  return (
    <div className="cloud-ams-connection">
      {!state?.authenticated && (
        <p className="field-note ams-intro">
          Read your loaded spools with Bambu Cloud.
        </p>
      )}
      {!started ? (
        <Button
          onClick={() => {
            setError('');
            setStarted(true);
          }}
        >
          Connect Bambu Cloud
        </Button>
      ) : unavailable ? (
        <div className="cloud-unavailable" aria-live="polite">
          <p>
            Can’t reach Bambu Cloud. Use your label choices or the manual
            picker.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError('');
              setRetry((value) => value + 1);
            }}
          >
            Retry connection
          </Button>
        </div>
      ) : !state?.authenticated ? (
        <form
          className="ams-cloud-login"
          onSubmit={(event) => {
            event.preventDefault();
            if (state?.codeRequested) {
              const supplied = code;
              setCode('');
              void action(async (connection, signal) => {
                const value = await connection.login(supplied, signal);
                if (!signal.aborted) setEmail('');
                return value;
              });
            } else
              void action((connection, signal) =>
                connection.sendCode(email.trim(), signal),
              );
          }}
        >
          {!state?.codeRequested ? (
            <>
              <p className="field-note">
                Use a global-region account with a cloud-connected printer.
              </p>
              <label htmlFor="cloud-ams-email">
                Bambu account email (global region)
                <Input
                  id="cloud-ams-email"
                  type="email"
                  maxLength={254}
                  autoComplete="off"
                  required
                  value={email}
                  disabled={busy || !state}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="ams-auto">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />{' '}
                I agree to let Spoolstamp use my Bambu sign-in to read my AMS.
              </label>
              <Button type="submit" disabled={busy || !consent || !state}>
                {busy ? 'Requesting…' : 'Send verification email'}
              </Button>
            </>
          ) : (
            <>
              <label htmlFor="cloud-ams-code">
                Email verification code
                <Input
                  id="cloud-ams-code"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setCode('');
                  void action((connection, signal) =>
                    connection.logout(signal),
                  );
                }}
              >
                Cancel / start again
              </Button>
            </>
          )}
          <p className="field-note">
            No password needed. Connection lasts up to 30 minutes; sign out to
            end it sooner.
          </p>
          <details className="field-note">
            <summary>Privacy details</summary>
            <p>
              The session starts when you connect. Spoolstamp handles your email
              and verification code. Your email and connection token are
              temporarily encrypted on our server, never saved in browser
              storage. Verification codes aren’t stored. Signing out deletes the
              session. Expired encrypted records may remain for days until
              cleanup.
            </p>
          </details>
        </form>
      ) : (
        <>
          <label htmlFor="cloud-ams-printer">
            Printer
            <select
              id="cloud-ams-printer"
              value={printer}
              disabled={busy || state.pending}
              onChange={(event) => {
                selectedPrinter.current = event.target.value;
                setPrinter(event.target.value);
                callback.current(null);
              }}
            >
              <option value="">Choose a printer</option>
              {state.printers.map((item) => (
                <option key={item.serial} value={item.serial}>
                  {item.name} ({item.model}){item.online ? '' : ' — offline'}
                </option>
              ))}
            </select>
          </label>
          {!state.printers.length && (
            <p className="field-note">
              No printers returned by this Bambu account.
            </p>
          )}
          <div className="ams-actions">
            <Button
              disabled={
                busy ||
                state.pending ||
                !printer ||
                (printer === state.selectedSerial && wait > 0)
              }
              onClick={() =>
                void action((connection, signal) =>
                  connection.snapshot(printer, signal),
                )
              }
            >
              {state.pending
                ? 'Reading AMS…'
                : printer === state.selectedSerial && wait > 0
                  ? `Refresh in ${formatReadWait(wait)}`
                  : 'Read AMS'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                callback.current(null);
                void action((connection, signal) => connection.logout(signal));
              }}
            >
              Sign out
            </Button>
          </div>
          <AmsConnectionStatus
            state={state}
            printer={printer}
            now={clock}
            hasLabelChoices={hasLabelChoices}
          />
          <details className="ams-help field-note">
            <summary>How it works</summary>
            <p>
              One read gives you reusable label choices for this visit. Save a
              draft to keep a label for later.
            </p>
            <p>
              Live inventory is current for 45 seconds. Refresh is limited to
              once every five minutes; it is only needed to check changed
              spools. Confirm physical spools in Studio before printing.
            </p>
          </details>
        </>
      )}
      {error && !unavailable && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
