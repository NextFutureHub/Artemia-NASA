/** Post-login and preparation gates used by acceptance A01–A02. */

export function postLoginPath(role: 'astronaut' | 'doctor', hasLocalProfile: boolean): string {
  if (role === 'doctor') return '/ground/inbox'
  return hasLocalProfile ? '/onboard/today' : '/prepare'
}

export function preparationCanStart(
  checks: Array<{ status: 'pending' | 'ok' | 'failed' }>,
  otherOwner: boolean,
): boolean {
  return checks.length > 0 && checks.every((item) => item.status === 'ok') && !otherOwner
}

/** Today needs a prepared local profile; a live token is not required after A03. */
export function journalRouteAllowed(hasLocalProfile: boolean): boolean {
  return hasLocalProfile
}
