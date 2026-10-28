import { describe, expect, it } from 'vitest';
import { hash, verify } from '@/lib/auth/passwords';

describe('lib/auth/passwords', () => {
  it('verifies a hash against its source plaintext', async () => {
    const stored = await hash('correct horse battery staple');
    expect(await verify('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong plaintext against a real hash', async () => {
    const stored = await hash('correct horse battery staple');
    expect(await verify('Tr0ub4dor&3', stored)).toBe(false);
  });

  it('produces argon2id-formatted hashes', async () => {
    const stored = await hash('whatever');
    // argon2id prefix per the Argon2 spec encoding. If this ever changes
    // we want a loud test failure (means a future deps upgrade quietly
    // swapped algorithms — security-meaningful regression).
    expect(stored.startsWith('$argon2id$')).toBe(true);
  });

  it('returns false (does not throw) on a malformed stored hash', async () => {
    expect(await verify('whatever', 'not-actually-a-hash')).toBe(false);
  });
});
