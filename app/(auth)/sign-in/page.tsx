import { isGoogleConfigured } from '@/lib/auth/google';
import { SignInPage } from './SignInPage';

// The server decides whether Google sign-in is offered (lib/auth/google.ts),
// per request, so an image built without Google credentials offers it as soon
// as the deployment that runs it has them.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <SignInPage googleEnabled={isGoogleConfigured()} />;
}
