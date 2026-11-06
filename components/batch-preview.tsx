/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This named inline SVG is the actual graphic, not a URL-backed img. */
import { useId } from 'react';
import type { PreparedLabelPlates } from '@/lib/generate-label-plates';
import { textColorForFilament } from '@/lib/filament-appearance';

export function BatchPreview({
  plan,
  busy = false,
  error,
}: {
  plan: PreparedLabelPlates | null;
  busy?: boolean;
  error?: string;
}) {
  const id = useId().replace(/:/g, '');
  if (!plan && !busy && !error) return null;
  return (
    <section
      className="batch-preview"
      aria-label="Batch preview"
      aria-busy={busy}
    >
      <h3>Batch preview</h3>
      {busy && <p className="field-note">Preparing exact placements…</p>}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {plan && !busy && !error && (
        <>
          <p className="field-note">
            {plan.labelCount} {plan.labelCount === 1 ? 'label' : 'labels'} ·{' '}
            {plan.plateCount}{' '}
            {plan.layout === 'separate'
              ? `separate ${plan.plateCount === 1 ? 'project' : 'projects'}`
              : `plate ${plan.plateCount === 1 ? 'project' : 'projects'}`}{' '}
            · {plan.printer.replace('Bambu Lab ', '')}
          </p>
          {plan.plates.map((plate, index) => {
            const bed = plate.bed.bounds;
            const width = bed.maxX - bed.minX;
            const height = bed.maxY - bed.minY;
            const y = (maxY: number) => bed.minY + bed.maxY - maxY;
            const hatch = `${id}-excluded-${index}`;
            const title = `${id}-title-${index}`;
            return (
              <figure className="batch-preview-plate" key={index}>
                <svg
                  viewBox={`${bed.minX} ${bed.minY} ${width} ${height}`}
                  role="img"
                  aria-labelledby={title}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <title
                    id={title}
                  >{`Project ${index + 1}: ${plate.labels.length} ${plate.labels.length === 1 ? 'label' : 'labels'}, top-down bounds preview`}</title>
                  <defs>
                    <pattern
                      id={hatch}
                      width="6"
                      height="6"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M-1 1L1 -1M0 6L6 0M5 7L7 5"
                        stroke="#73828a"
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>
                  <rect
                    x={bed.minX}
                    y={bed.minY}
                    width={width}
                    height={height}
                    fill="#151b1e"
                    stroke="#74828b"
                    strokeWidth="1"
                  />
                  <rect
                    x={plate.bed.common.minX}
                    y={y(plate.bed.common.maxY)}
                    width={plate.bed.common.maxX - plate.bed.common.minX}
                    height={plate.bed.common.maxY - plate.bed.common.minY}
                    fill="none"
                    stroke="#839586"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  {plate.bed.restricted.map((rect, at) => (
                    <rect
                      key={at}
                      x={rect.minX}
                      y={y(rect.maxY)}
                      width={rect.maxX - rect.minX}
                      height={rect.maxY - rect.minY}
                      fill={`url(#${hatch})`}
                      stroke="#73828a"
                      strokeWidth=".5"
                    >
                      <title>
                        {rect.kind === 'excluded'
                          ? 'Excluded bed area'
                          : 'Single-nozzle-only area'}
                      </title>
                    </rect>
                  ))}
                  {plate.labels.map((label) => {
                    const box = label.placement.bounds;
                    return (
                      <g key={label.index}>
                        <rect
                          x={box.min[0]}
                          y={y(box.max[1])}
                          width={box.max[0] - box.min[0]}
                          height={box.max[1] - box.min[1]}
                          fill={label.bodyColor}
                          stroke="#c6d2ca"
                          strokeWidth=".8"
                        >
                          <title>{`${label.index}. ${label.name}`}</title>
                        </rect>
                        <text
                          x={(box.min[0] + box.max[0]) / 2}
                          y={y((box.min[1] + box.max[1]) / 2)}
                          dominantBaseline="central"
                          textAnchor="middle"
                          fill={textColorForFilament([label.bodyColor])}
                          fontSize="12"
                          fontWeight="700"
                        >
                          {label.index}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <figcaption>
                  <strong>Project {index + 1}</strong> · {plate.labels.length}{' '}
                  {plate.labels.length === 1 ? 'label' : 'labels'} ·{' '}
                  {plate.filaments.length}{' '}
                  {plate.filaments.length === 1 ? 'filament' : 'filaments'}
                </figcaption>
                <ol className="batch-preview-labels">
                  {plate.labels.map((label) => (
                    <li key={label.index} value={label.index}>
                      {label.product} · {label.colorName}{' '}
                      <span
                        className="batch-preview-color"
                        style={{ background: label.bodyColor }}
                        aria-label={`Body ${label.bodyColor}`}
                      />
                      <span
                        className="batch-preview-color"
                        style={{ background: label.textColor }}
                        aria-label={`Text ${label.textColor}`}
                      />
                    </li>
                  ))}
                </ol>
                <details className="batch-preview-filaments">
                  <summary>Project filaments</summary>
                  <ul>
                    {plate.filaments.map((spool, at) => (
                      <li key={at}>
                        <span
                          className="batch-preview-color"
                          style={{ background: spool.color }}
                        />
                        {spool.product} · {spool.color}
                      </li>
                    ))}
                  </ul>
                </details>
              </figure>
            );
          })}
          <p className="field-note">
            Bounds preview—not a slice. Stripes mark restricted areas. The
            download uses these placements; check spool assignments, brim and
            purge-tower clearance in Studio.
          </p>
        </>
      )}
    </section>
  );
}
