'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from './ui/button';
import { InfoDialog } from './info-dialog';

export function PrintGuide() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className="print-guide-launcher"
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <HelpCircle size={16} /> How to print
      </Button>
      <InfoDialog
        open={open}
        onClose={() => setOpen(false)}
        id="print-guide-heading"
        title="Print your label"
      >
        <ol className="print-guide-steps">
          <li>
            <strong>Open the 3MF as a project</strong>
            <p>
              Download your file, then open it in Bambu Studio and choose{' '}
              <b>Open as project</b> when prompted. For a ZIP, extract it first
              and open each plate project.
            </p>
          </li>
          <li>
            <strong>Match your filaments</strong>
            <p>
              Check the printer and the body and text colors. Assign each
              project filament to the matching physical spool or AMS slot.
            </p>
          </li>
          <li>
            <strong>Slice, check, then print</strong>
            <p>
              Inspect the lettering, plate spacing, brim and purge tower in the
              sliced preview before sending the print.
            </p>
          </li>
        </ol>
        <p className="field-note">
          Flat labels print backing-down. Add suitable adhesive after printing;
          test it on your intended surface first.
        </p>
      </InfoDialog>
    </>
  );
}
