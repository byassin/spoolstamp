import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { cloudDisplayText } from './cloud-ams-errors.ts';
import {
  CloudAmsError,
  createCloudAmsSession,
  type CloudRegion,
} from './cloud-ams.ts';

const HELP = `Spoolstamp experimental cloud AMS test (not the hosted feature).
Usage: npm run probe:ams:cloud -- --run [--region global|china] [--auth email|code|token]

No credentials in arguments, environment variables, files, or logs.
Email login sends one verification email after explicit confirmation.
Code login uses a verification email you already received; it sends no new email.
Token login prompts without echo; treat the token as a sensitive account credential.
Only account-bound printers can be read. No printer-control commands are sent.
This developer test runs here to validate cloud access before deployment;
the eventual hosted feature will not require a local installation or bridge.
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log(HELP);
    return;
  }
  let region: CloudRegion = 'global';
  let auth = 'email';
  let run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run') run = true;
    else if (
      args[i] === '--region' &&
      ['global', 'china'].includes(args[i + 1])
    )
      region = args[++i] as CloudRegion;
    else if (
      args[i] === '--auth' &&
      ['email', 'code', 'token'].includes(args[i + 1])
    )
      auth = args[++i];
    else throw new CloudAmsError('input');
  }
  if (
    !run ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    (region === 'china' && auth !== 'token')
  )
    throw new CloudAmsError('input');
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const session = createCloudAmsSession(region);
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
    readline.close();
  };
  readline.on('SIGINT', cancel);
  process.once('SIGINT', cancel);
  async function ask(prompt: string, secret = false) {
    if (controller.signal.aborted) throw new CloudAmsError('cancelled');
    if (secret) {
      process.stdout.write(prompt);
      muted = true;
    }
    try {
      return (
        await readline.question(secret ? '' : prompt, {
          signal: controller.signal,
        })
      ).trim();
    } finally {
      muted = false;
      if (secret) process.stdout.write('\n');
    }
  }
  try {
    console.log(
      'Experimental, unofficial Bambu Cloud integration. The printer must be cloud-connected.',
    );
    console.log(
      'Credentials stay in this process and are not saved. Do not paste secrets into the chat.',
    );
    if (auth === 'email' || auth === 'code') {
      const email = await ask('Bambu account email: ');
      if (auth === 'email') {
        if (
          (await ask('Send one Bambu verification email? Type SEND: ')) !==
          'SEND'
        )
          throw new CloudAmsError('cancelled');
        await session.requestEmailCode(email);
      } else
        console.log(
          'Using the code already received. No new verification email will be requested.',
        );
      await session.loginWithEmailCode(
        email,
        await ask('Email verification code (hidden): ', true),
      );
    } else
      session.useAccessToken(
        await ask('Bambu account access token (hidden): ', true),
      );
    const printers = await session.printers();
    if (!printers.length) {
      console.log('No printers are bound to this account.');
      return;
    }
    printers.forEach((printer, index) =>
      console.log(
        `${index + 1}. ${printer.name || printer.model || 'Printer'} (${printer.model || 'unknown model'}) — ${printer.online ? 'online' : 'offline'}`,
      ),
    );
    const choice = await ask('Printer number to read: ');
    if (!/^\d{1,3}$/.test(choice) || !printers[Number(choice) - 1])
      throw new CloudAmsError('input');
    console.log('Waiting up to 60 seconds for one fresh AMS snapshot...');
    const snapshot = await session.snapshot(
      printers[Number(choice) - 1].serial,
      { signal: controller.signal },
    );
    console.log(
      `Fresh cloud snapshot received at ${new Date(snapshot.updatedAt).toISOString()}.`,
    );
    if (!snapshot.slots.length)
      console.log(
        'The snapshot contains no AMS trays. This is not proof of populated AMS inventory.',
      );
    for (const slot of snapshot.slots) {
      const state = slot.reading
        ? 'scanning'
        : slot.present === false
          ? 'empty'
          : slot.present === true
            ? 'present'
            : 'presence unknown';
      console.log(
        `${slot.label}: ${state}; ${cloudDisplayText(slot.material) || 'unknown material'}; ${cloudDisplayText(slot.productId) || 'unknown product'}; ${slot.color || 'unknown color'}; remaining ${slot.remaining ?? 'unknown'}`,
      );
    }
    console.log(
      'Connection closed. Compare these slots with Bambu Handy/the printer to qualify the result.',
    );
  } finally {
    session.close();
    readline.close();
    output.end();
    process.removeListener('SIGINT', cancel);
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof CloudAmsError
      ? error.message
      : 'Cloud AMS test stopped safely. No private error details were logged.',
  );
  if (error instanceof CloudAmsError && error.diagnostic) {
    const details = error.diagnostic;
    // Every value below is our own bounded enum or HTTP status; never raw body,
    // vendor message, account address, code/token, URL, or arbitrary API code.
    console.error(
      `Safe response diagnostic: operation=${details.operation}; HTTP=${details.status}; body=${details.body}; api-code=${details.apiCode}; success=${details.success}; error=${details.error}`,
    );
  }
  process.exitCode = 1;
});
