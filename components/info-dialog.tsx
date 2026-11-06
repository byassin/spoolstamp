'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';

export function InfoDialog({
  open,
  onClose,
  id,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="info-dialog"
      aria-labelledby={id}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="info-dialog-heading">
        <h2 id={id}>{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
