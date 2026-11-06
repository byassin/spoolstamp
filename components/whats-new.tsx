'use client';

import { useState } from 'react';
import { APP_VERSION, APP_VERSION_LABEL } from '@/lib/app-version';
import { RELEASE_NOTES } from '@/lib/release-notes';
import { InfoDialog } from './info-dialog';

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const current = RELEASE_NOTES.find(
    (release) => release.version === APP_VERSION,
  );
  return (
    <>
      <button
        className="app-version version-launcher"
        type="button"
        aria-label={`What's new in version ${APP_VERSION}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {APP_VERSION_LABEL}
      </button>
      <InfoDialog
        open={open}
        onClose={() => setOpen(false)}
        id="whats-new-heading"
        title="What's new"
      >
        <p className="release-version">Spoolstamp {APP_VERSION_LABEL}</p>
        <ul className="release-highlights">
          {current?.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        <details className="earlier-releases">
          <summary>Earlier updates</summary>
          {RELEASE_NOTES.filter((release) => release !== current).map(
            (release) => (
              <section key={release.version}>
                <h3>v{release.version}</h3>
                <ul>
                  {release.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </details>
      </InfoDialog>
    </>
  );
}
