import { MessageSchema } from '../src/schemas';

describe('Zod message validation', () => {
  it('accepts valid CREATE_SESSION', () => {
    const valid = {
      type: 'CREATE_SESSION',
      sessionId: 'abc',
      url: 'https://example.com'
    };
    expect(() => MessageSchema.parse(valid)).not.toThrow();
  });

  it('rejects malformed message', () => {
    const invalid = { type: 'CREATE_SESSION', sessionId: 42 };
    expect(() => MessageSchema.parse(invalid)).toThrow();
  });
});