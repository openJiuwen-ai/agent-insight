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

/**
 * Shared tool-call deduplication.
 *
 * OpenCode's streamed uploader emits several parts for one physical tool call
 * (pending / running / completed…), all carrying the same call id. Both the
 * trace tree and the persisted metrics must count that call once, so the key
 * and merge rules live here instead of being duplicated per consumer.
 */

export interface ToolCallLike {
    id?: string;
    function?: { name?: string; arguments?: string };
    name?: string;
    arguments?: string;
    output?: any;
    result?: any;
    timing?: { started_at?: number; completed_at?: number };
}

function stableStringify(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/** The call id, when the uploader provided one. */
function idKey(tc: ToolCallLike): string | undefined {
    const id = tc.id;
    return typeof id === 'string' && id.trim() ? `id:${id.trim()}` : undefined;
}

/**
 * Stable identity for a tool call: the call id when present, else a signature
 * built from name + arguments (legacy payloads carry no id).
 */
export function toolCallKey(tc: ToolCallLike): string {
    const key = idKey(tc);
    if (key) return key;
    const name = tc.function?.name || tc.name || 'unknown';
    const args = tc.function?.arguments ?? tc.arguments ?? '';
    return `sig:${name}:${stableStringify(args)}`;
}

function mergeToolCall<T extends ToolCallLike>(existing: T, incoming: T): T {
    const out: T = { ...existing, ...incoming };
    if (existing.output !== undefined && incoming.output === undefined) out.output = existing.output;
    if (existing.result !== undefined && incoming.result === undefined) out.result = existing.result;
    if (existing.timing && !incoming.timing) out.timing = existing.timing;
    return out;
}

/** Collapse entries sharing a key; entries whose key is undefined stay distinct. */
function collapse<T extends ToolCallLike>(calls: T[], keyOf: (tc: T) => string | undefined): T[] {
    const out: T[] = [];
    const pos = new Map<string, number>();
    for (const tc of calls) {
        const key = keyOf(tc);
        if (key === undefined) {
            out.push(tc);
            continue;
        }
        const idx = pos.get(key);
        if (idx == null) {
            pos.set(key, out.length);
            out.push(tc);
        } else {
            out[idx] = mergeToolCall(out[idx], tc);
        }
    }
    return out;
}

/**
 * Collapse repeated parts of the same call into one entry, keeping the latest.
 * Falls back to the name+arguments signature for payloads without an id.
 */
export function dedupeToolCalls<T extends ToolCallLike>(calls: T[]): T[] {
    return collapse(calls, (tc) => toolCallKey(tc));
}

/**
 * Count-oriented variant: only entries sharing a call id are collapsed.
 *
 * Two distinct calls to the same tool with identical arguments (e.g. reading
 * the same file twice) are separate invocations; merging them by signature
 * would under-count real work, so id-less entries are always kept separate.
 * Streamed parts of one physical call always carry the id, which is the case
 * this exists to fix.
 */
export function dedupeToolCallsById<T extends ToolCallLike>(calls: T[]): T[] {
    return collapse(calls, (tc) => idKey(tc));
}
