import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

test('demo seed and env example do not contain passwords', () => {
  const seed = readFileSync(join(root, 'backend', 'app', 'seed.py'), 'utf8')
  const example = readFileSync(join(root, '.env.example'), 'utf8')
  assert.match(seed, /ORBIT-DEMO-01/)
  assert.match(seed, /Mira-01/)
  assert.match(seed, /Alex-02/)
  assert.match(seed, /Flight-Doc/)
  assert.doesNotMatch(seed, /password\s*[:=]\s*['"][^'"]+['"]/)
  assert.match(example, /^SEED_MIRA_PASSWORD=$/m)
  assert.match(example, /^SEED_ALEX_PASSWORD=$/m)
  assert.match(example, /^SEED_FLIGHT_DOC_PASSWORD=$/m)
  assert.doesNotMatch(example, /SUPABASE/)
  assert.doesNotMatch(example, /VITE_/)
  assert.doesNotMatch(example, /service_role/i)
})
