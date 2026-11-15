import type { CareOrderKind } from './enums.ts'

/** Observation-plan tasks that belong in the personal / sensitive surface — not prescriptions. */
const PERSONAL_CARE_KINDS: ReadonlySet<CareOrderKind> = new Set(['symptom_monitor', 'recommendation', 'follow_up'])

export function isPersonalCareTask(order: { kind: CareOrderKind }): boolean {
  return PERSONAL_CARE_KINDS.has(order.kind)
}
