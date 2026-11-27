import { isAuthError } from '@supabase/supabase-js';

export function signInErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    if (error.code === 'invalid_credentials') return 'Email or password is incorrect.';
    if (error.code === 'email_not_confirmed') return 'Please contact your project administrator to confirm your account.';
    if (error.status === 429) return 'Too many sign-in attempts. Please wait a moment and try again.';
  }
  return 'Unable to sign in. Please check your connection and try again.';
}
