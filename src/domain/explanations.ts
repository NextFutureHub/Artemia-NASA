export type RuleId =
  | 'DATA_CONTACT_LOST_V1'
  | 'DATA_NO_CURRENT_V1'
  | 'SELF_REVIEW_REQUEST_V1'
  | 'SYNC_AUTH_REQUIRED_V1'
  | 'HISTORY_CHANGE_V1'

export type ExplanationCard = {
  ruleId: RuleId
  version: '1'
  kind: 'technical_quality' | 'user_action' | 'descriptive_change'
  inputs: Array<{ label: string; href: string | null }>
  computedAt: string
  prototype: true
  sourceId: null
  home: boolean
}

const RULES: Record<RuleId, Pick<ExplanationCard, 'kind' | 'home'>> = {
  DATA_CONTACT_LOST_V1: { kind: 'technical_quality', home: true },
  DATA_NO_CURRENT_V1: { kind: 'technical_quality', home: true },
  SELF_REVIEW_REQUEST_V1: { kind: 'user_action', home: true },
  SYNC_AUTH_REQUIRED_V1: { kind: 'technical_quality', home: true },
  HISTORY_CHANGE_V1: { kind: 'descriptive_change', home: false },
}

export function explanationCard(ruleId: RuleId, inputs: ExplanationCard['inputs'], computedAt: string): ExplanationCard {
  const rule = RULES[ruleId]
  return {
    ruleId,
    version: '1',
    kind: rule.kind,
    inputs,
    computedAt,
    prototype: true,
    sourceId: null,
    home: rule.home,
  }
}

export function displayComment(value: string | null | undefined): string {
  return value ?? ''
}
