import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  celsiusToFahrenheit,
  cmToFeetInches,
  fahrenheitToCelsius,
  formatMassFromKg,
  formatTemperatureFromCelsius,
  kgToLb,
  lbToKg,
  switchDraftField,
  temperatureDraftToCelsius,
} from './unitSystem.ts'

test('37 °C ↔ 98.6 °F and 100 kg ↔ 220.5 lb', () => {
  assert.equal(formatTemperatureFromCelsius(37, 'us'), '98.6')
  assert.equal(roundish(fahrenheitToCelsius(98.6)), 37)
  assert.equal(formatTemperatureFromCelsius(fahrenheitToCelsius(98.6), 'metric'), '37')
  assert.equal(formatMassFromKg(100, 'us'), '220.5')
  assert.equal(roundish(lbToKg(220.5)), 100)
  assert.equal(formatMassFromKg(lbToKg(220.5), 'metric'), '100')
})

test('repeated unit switches do not accumulate error', () => {
  let display = '37'
  let system: 'metric' | 'us' = 'metric'
  for (let i = 0; i < 20; i += 1) {
    const next = system === 'metric' ? 'us' : 'metric'
    const switched = switchDraftField('temperature', display, system, next)
    assert.equal(switched.ok, true)
    if (!switched.ok) return
    display = switched.next
    system = next
  }
  assert.equal(system, 'metric')
  assert.equal(display, '37')
  const celsius = temperatureDraftToCelsius(display, 'metric')
  assert.equal(celsius, 37)
})

test('incomplete draft blocks unit switch', () => {
  const blocked = switchDraftField('temperature', '98.', 'us', 'metric')
  assert.equal(blocked.ok, false)
  const empty = switchDraftField('temperature', '', 'us', 'metric')
  assert.equal(empty.ok, true)
  if (empty.ok) assert.equal(empty.next, '')
})

test('height carry 12 inches into the next foot', () => {
  // 182.88 cm = 72 inches exactly → 6' 0"
  const parts = cmToFeetInches(182.88)
  assert.equal(parts.feet, 6)
  assert.equal(parts.inches, 0)
})

test('exact conversion helpers stay invertible at acceptance points', () => {
  assert.equal(roundish(celsiusToFahrenheit(37)), 98.6)
  assert.equal(roundish(kgToLb(100)), 220.5)
})

function roundish(value: number): number {
  return Math.round(value * 10) / 10
}
