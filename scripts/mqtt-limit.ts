/** Bound MQTT 3 packet lengths from the wire header before the client buffers a payload. */
export function mqttPacketLimit(maxBytes = 512 * 1024) {
  let phase: 'header' | 'length' | 'body' = 'header';
  let length = 0,
    multiplier = 1,
    digits = 0,
    remaining = 0;
  return (bytes: Uint8Array) => {
    for (let offset = 0; offset < bytes.length;) {
      if (phase === 'header') {
        offset++;
        phase = 'length';
        length = 0;
        multiplier = 1;
        digits = 0;
      } else if (phase === 'length') {
        const value = bytes[offset++];
        digits++;
        length += (value & 127) * multiplier;
        if (length > maxBytes || digits > 4 || (digits === 4 && value & 128))
          return false;
        if (value & 128) multiplier *= 128;
        else {
          remaining = length;
          phase = remaining ? 'body' : 'header';
        }
      } else {
        const count = Math.min(remaining, bytes.length - offset);
        offset += count;
        remaining -= count;
        if (!remaining) phase = 'header';
      }
    }
    return true;
  };
}
