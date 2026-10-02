/**
 * The invite code a provider arrived with, held across sign-up.
 *
 * A provider opening `#/plan-invite/SP-1234ABCD` usually has no account yet, so
 * the code has to survive a trip through registration and login before the
 * onboarding wizard can apply it. `sessionStorage`, not `localStorage`: it is
 * one signup's worth of state, and a code left behind in a shared browser
 * would silently put the *next* person who registers on someone else's private
 * plan.
 */

const KEY = 'boatpro.pendingPlanInvite'

export function setPendingInvite(code: string): void {
  try {
    sessionStorage.setItem(KEY, code.trim().toUpperCase())
  } catch {
    // Private-mode / storage-disabled browsers. The code is still in the URL
    // the provider is looking at, and the wizard accepts it typed in by hand.
  }
}

export function getPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear if it could never be written */
  }
}
