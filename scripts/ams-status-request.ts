/** The only cloud publish payload: ask for a full status report, never control. */
export const STATUS_REQUEST = JSON.stringify({
  pushing: {
    sequence_id: '20001',
    command: 'pushall',
    version: 1,
    push_target: 1,
  },
});
