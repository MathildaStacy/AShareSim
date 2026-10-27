export const sse = (...events: any[]) =>
  events
    .map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n')
    .join('');

export const aStart = {
  type: 'message_start',
  message: {
    model: 'm',
    content: [],
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
    },
  },
};
export const aText = {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
};
export const aDelta = (text: string) => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text },
});
export const aEnd = [
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 7 },
  },
  { type: 'message_stop' },
];
