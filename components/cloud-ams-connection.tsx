'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { createHostedAmsClient } from '../lib/cloud-ams-client';
import type { HostedCloudState } from '../lib/cloud-ams';
import type { AmsInventory } from '../lib/ams';
import { PRINTERS } from '../lib/catalog';

export function CloudAmsConnection({
  origin,
  onInventory,
}: {
  origin: string;
  onInventory: (value: AmsInventory | null) => void;
}) {
  const [state, setState] = useState<HostedCloudState | null>(null);
  const [started, setStarted] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [printer, setPrinter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const client = useRef<ReturnType<typeof createHostedAmsClient> | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const working = useRef(false);
  const callback = useRef(onInventory);
  useLayoutEffect(() => {
    callback.current = onInventory;
  }, [onInventory]);
  function accept(value: HostedCloudState) {
    setState(value);
    setClock(Date.now());
    const model = value.printers.find(
      (item) => item.serial === value.selectedSerial,
    )?.model;
    const profile = PRINTERS.find(
      (item) => item.name === model || item.fullName === model,
    );
    callback.current({
      ...value.inventory,
      printerName: profile?.fullName ?? value.inventory.printerName,
    });
    if (!value.authenticated) setPrinter('');
  }
  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    lifecycle.current = controller;
    const connection = createHostedAmsClient(origin);
    client.current = connection;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = revision.current;
      try {
        if (!working.current) {
          const value = await connection.read(controller.signal);
          if (!controller.signal.aborted && version === revision.current)
            accept(value);
        }
      } catch {
        if (!controller.signal.aborted && version === revision.current) {
          callback.current(null);
          setState(null);
          setError(
            'Cloud service unavailable. Check the connection or use the manual picker.',
          );
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      client.current = null;
    };
  }, [origin, started]);
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
      <p className="field-note">
        Experimental Bambu Cloud connection. Your printer must be
        cloud-connected. No local helper is needed.
      </p>
      {!started ? (
        <Button
          onClick={() => {
            setError('');
            setStarted(true);
          }}
        >
          Connect Bambu Cloud
        </Button>
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
                I accept this unofficial, temporary connection. Spoolstamp’s
                backend handles my email and verification code; my Bambu token
                stays server-side, never in browser storage. Hosted AWS sessions
                temporarily store my email/token encrypted, but never the code.
                Sessions expire after 30 minutes; expired encrypted records may
                remain until asynchronous cleanup. Sign out deletes the session.
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
            No password requested. No credentials saved in your browser. Sign-in
            expires after 30 minutes. Hosted AWS sessions survive backend restarts;
            sign out to end the session early.
          </p>
        </form>
      ) : (
        <>
          <label htmlFor="cloud-ams-printer">
            Your printer
            <select
              id="cloud-ams-printer"
              value={printer}
              disabled={busy || state.pending}
              onChange={(event) => setPrinter(event.target.value)}
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
                  ? `Refresh in ${wait}s`
                  : 'Read fresh AMS'}
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
          <output className="field-note">{state.inventory.message}</output>
          <p className="field-note">
            Snapshots are on demand, not continuous monitoring. Status requests
            are limited to one per printer every five minutes. Label actions
            require a snapshot less than 45 seconds old. If you change spools,
            wait and read again.
          </p>
        </>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
