import { beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { setSuppliedDryBoxBuffer } from '../lib/supplied-drybox';
import { setVectorTextFontBuffer } from '../lib/vector-text';
import { setClipLabelBuffer } from '../lib/clip-label';

beforeAll(() => {
  const clip = readFileSync(
    new URL('../assets/clip-label.mesh', import.meta.url),
  );
  setClipLabelBuffer(
    clip.buffer.slice(clip.byteOffset, clip.byteOffset + clip.byteLength),
  );
  const mesh = readFileSync(
    new URL('../assets/supplied-drybox.mesh', import.meta.url),
  );
  setSuppliedDryBoxBuffer(
    mesh.buffer.slice(mesh.byteOffset, mesh.byteOffset + mesh.byteLength),
  );
  setVectorTextFontBuffer(
    readFileSync(
      new URL(
        '../node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff',
        import.meta.url,
      ),
    ),
  );
});
