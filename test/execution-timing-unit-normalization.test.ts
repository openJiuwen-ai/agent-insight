/*
 * Copyright (c) 2026 Huawei Technologies Co., Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentCallTree, resolveTraceTimelineBounds } from '@/lib/engine/observability/agent-trace';
import { deriveExecutionTiming, toEpochMs } from '@/lib/engine/observability/execution-timing';

/** 10-digit Unix seconds, the shape historical / third-party payloads use. */
const BASE_SECONDS = 1_761_700_000;

test('toEpochMs: seconds, milliseconds and ISO strings all resolve to epoch ms', () => {
  assert.equal(toEpochMs(BASE_SECONDS), BASE_SECONDS * 1000);
  assert.equal(toEpochMs(BASE_SECONDS * 1000), BASE_SECONDS * 1000);
  assert.equal(toEpochMs(String(BASE_SECONDS)), BASE_SECONDS * 1000);
  assert.equal(toEpochMs(String(BASE_SECONDS * 1000)), BASE_SECONDS * 1000);
  assert.equal(toEpochMs('2026-04-30T04:30:57.000Z'), Date.parse('2026-04-30T04:30:57.000Z'));
  assert.equal(toEpochMs(''), undefined);
  assert.equal(toEpochMs(null), undefined);
});

test('execution timing: seconds-based timestamps are not read as milliseconds', () => {
  // Same interaction sequence as the millisecond case below: 61s of work.
  // Reading the seconds value as ms shrank the active duration by 1000x.
  const timing = deriveExecutionTiming([
    { role: 'user', content: 'go', timestamp: BASE_SECONDS },
    {
      role: 'assistant',
      content: 'done',
      timestamp: BASE_SECONDS + 1,
      timeInfo: { created: BASE_SECONDS + 1, completed: BASE_SECONDS + 61 },
    },
  ]);

  assert.equal(timing.startedAt, BASE_SECONDS * 1000);
  assert.equal(timing.activeDurationMs, 61_000);
  assert.equal(timing.elapsedDurationMs, 61_000);
});

test('execution timing: millisecond timestamps are unchanged', () => {
  const base = BASE_SECONDS * 1000;
  const timing = deriveExecutionTiming([
    { role: 'user', content: 'go', timestamp: base },
    {
      role: 'assistant',
      content: 'done',
      timestamp: base + 1000,
      timeInfo: { created: base + 1000, completed: base + 61_000 },
    },
  ]);

  assert.equal(timing.activeDurationMs, 61_000);
  assert.equal(timing.elapsedDurationMs, 61_000);
});

test('agent trace: seconds-based span bounds agree with execution timing', () => {
  const tree = buildAgentCallTree([
    { role: 'user', content: 'go', timestamp: BASE_SECONDS },
    {
      role: 'assistant',
      content: 'done',
      timestamp: BASE_SECONDS + 1,
      timeInfo: { created: BASE_SECONDS + 1, completed: BASE_SECONDS + 61 },
      usage: { total: 10 },
    },
  ] as any);

  assert.ok(tree);
  const bounds = resolveTraceTimelineBounds(tree);
  assert.ok(bounds);
  assert.equal(bounds!.start, BASE_SECONDS * 1000);
  assert.equal(bounds!.end, (BASE_SECONDS + 61) * 1000);
  assert.equal(bounds!.durationMs, 61_000);

  const timing = deriveExecutionTiming([
    { role: 'user', content: 'go', timestamp: BASE_SECONDS },
    {
      role: 'assistant',
      content: 'done',
      timestamp: BASE_SECONDS + 1,
      timeInfo: { created: BASE_SECONDS + 1, completed: BASE_SECONDS + 61 },
    },
  ]);
  assert.equal(bounds!.start, timing.startedAt);
  assert.equal(bounds!.end, timing.endedAt);
});
