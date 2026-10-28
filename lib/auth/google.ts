// Google sign-in is OPTIONAL (MOTIR-9810). A deployment registers the provider
// and shows the "Continue with Google" button only when BOTH credentials are
// set; with either missing, sign-in is email and password only. A preview
// environment has no Google credentials, and it must still let a reviewer in.
//
// One reader for "is Google configured?", so the provider registration
// (lib/auth/index.ts) and the button (the sign-in and sign-up pages) can never
// disagree about it.

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/** Both Google credentials, or null when either is missing or empty. */
export function googleCredentials(): GoogleCredentials | null {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function isGoogleConfigured(): boolean {
  return googleCredentials() !== null;
}
