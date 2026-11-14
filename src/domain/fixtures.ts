import type { GeneralPayload } from './generalPayload.ts'
import type { PersonalPayload } from './personalPayload.ts'

export function baseGeneral(patch: Partial<GeneralPayload> = {}): GeneralPayload {
  return {
    overall_state: 'fair',
    sleep_hours: 7.5,
    sleep_answer_status: 'answered',
    sleep_quality: null,
    sleep_quality_answer_status: 'unknown',
    fatigue_score: 0,
    fatigue_answer_status: 'answered',
    stress_score: null,
    stress_answer_status: 'declined',
    emotional_state: { value: 'calm', note: null },
    context: [],
    comment: 'Самочувствие',
    symptom_presence: 'no',
    symptoms: [],
    review_requested: false,
    ...patch,
  }
}

export function skippedPersonal(patch: Partial<PersonalPayload> = {}): PersonalPayload {
  return {
    bleeding_category: null,
    bleeding_category_answer_status: 'declined',
    bleeding_intensity: null,
    bleeding_intensity_answer_status: 'not_applicable',
    expectedness: null,
    expectedness_answer_status: 'declined',
    discomfort_score: null,
    discomfort_answer_status: 'unknown',
    activity_impact: null,
    activity_impact_answer_status: 'declined',
    cycle_context: null,
    cycle_context_answer_status: 'declined',
    prescribed_plan_adherence: null,
    prescribed_plan_adherence_answer_status: 'not_applicable',
    review_requested: false,
    comment: null,
    comment_answer_status: 'declined',
    ...patch,
  }
}
