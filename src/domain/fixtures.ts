import { skippedNutrition, type GeneralPayload } from './generalPayload.ts'
import type { PersonalPayload } from './personalPayload.ts'

export function baseGeneral(patch: Partial<GeneralPayload> = {}): GeneralPayload {
  return {
    overall_state: 'fair',
    report_period: {
      start_at: '2026-10-31T08:00:00.000Z',
      end_at: '2026-11-01T08:00:00.000Z',
    },
    sleep_hours: 7.5,
    sleep_answer_status: 'answered',
    sleep_quality: null,
    sleep_quality_answer_status: 'unknown',
    sleepiness: null,
    sleepiness_answer_status: 'declined',
    awakenings: null,
    awakenings_answer_status: 'declined',
    sleep_plan_deviation: null,
    sleep_plan_deviation_answer_status: 'declined',
    sleep_interfering: [],
    sleep_interfering_answer_status: 'declined',
    sleep_discuss: null,
    sleep_discuss_answer_status: 'declined',
    sleep_comment: null,
    sleep_intervals: [],
    sleep_duration_source: null,
    fatigue_score: 0,
    fatigue_answer_status: 'answered',
    stress_score: null,
    stress_answer_status: 'declined',
    emotional_state: { value: 'calm', note: null },
    context: [],
    comment: 'Самочувствие',
    nutrition: skippedNutrition(),
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
