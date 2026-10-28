import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

// Better-Auth's catch-all handler. Every /api/auth/* request (sign-in,
// sign-up, sign-out, OAuth callbacks, password-reset endpoints, etc.)
// lands here.
export const { GET, POST } = toNextJsHandler(auth);
