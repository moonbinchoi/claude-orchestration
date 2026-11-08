// stale-resume: UserPromptSubmit handler. Blocks the first prompt after an idle gap longer than the 1 h cache TTL when the
// context is large, because that prompt would rewrite the whole expired cache. The user resends to proceed: one block per gap. Fail-open: any problem returns null.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTail } from './transcript-read.mjs';

const ENTRYPOINTS = ['cli', 'claude-vscode'];
const GAP_MS = 60 * 60 * 1000;
const MIN_CONTEXT = 100_000;
// shortcut: a last assistant record more than 2 MB from the end is missed (no block); scan further back if tool outputs that large show up
const TAIL_BYTES = 2 * 1024 * 1024;
// 1 h cache-write $/M tokens from the 2026-11 token audit price table; other models get no dollar estimate
const WRITE_PRICE = { opus: 8, sonnet: 4 };

const contextOf = (u) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

// last main-conversation assistant record with nonzero usage (a synthetic API-error record has zero usage and wrote no cache);
// the first tail line may be cut, so unparsable lines are skipped
function lastAssistant(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let r;
    try { r = JSON.parse(lines[i]); } catch { continue; }
    if (r?.type === 'assistant' && r.isSidechain !== true && r.message?.usage && r.timestamp && contextOf(r.message.usage) > 0) return r;
  }
  return null;
}

export function onPrompt(input, { dir, env = process.env, now = Date.now, reader = readTail } = {}) {
  try {
    if (!ENTRYPOINTS.includes(env.CLAUDE_CODE_ENTRYPOINT ?? null) || env.CLAUDE_CODE_SESSION_ATTENDED === '0') return null;
    const sid = input?.session_id;
    if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sid) || typeof input.transcript_path !== 'string') return null;
    const last = lastAssistant(reader(input.transcript_path, TAIL_BYTES).text);
    if (!last) return null;
    const at = Date.parse(last.timestamp);
    const context = contextOf(last.message.usage);
    // ceil: a gap just over 60 min must never read "60분"
    const gapMin = Math.ceil((now() - at) / 60000);
    if (!(now() - at > GAP_MS) || context <= MIN_CONTEXT) return null;

    const k = Math.round(context / 1000);
    // marker per gap: the resent prompt finds it and passes; a later gap has a new last-assistant time and blocks again
    // shortcut: markers are never pruned; one empty file per blocked gap, delete old ones by hand if the dir grows
    const markerDir = join(dir, 'stale-resume-seen');
    mkdirSync(markerDir, { recursive: true });
    try { writeFileSync(join(markerDir, `${sid}-${at}`), '', { flag: 'wx' }); } catch (e) {
      if (e?.code !== 'EEXIST') return null;
      // the resend: the model cannot see idle time, so tell it for the Long work rule
      return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `This session resumed after ${gapMin} min idle with about ${k}K tokens of context; the cache was rewritten. Apply the Long work rule: write a status file if none exists and suggest a new session from it.` } };
    }

    const tier = Object.keys(WRITE_PRICE).find((k) => String(last.message.model ?? '').includes(k));
    const cost = tier ? ` (약 $${(context / 1e6 * WRITE_PRICE[tier]).toFixed(2)}, ${tier} 1시간 캐시 쓰기 단가 기준)` : '';
    const reason = `이 세션은 ${gapMin}분 동안 쉬어서 캐시가 만료되었습니다. 지금 보내면 컨텍스트 약 ${k}K 토큰을 다시 써야 합니다${cost}. `
      + '상태 파일에서 새 세션을 시작하기를 권합니다. 그래도 이어가려면 같은 프롬프트를 다시 보내세요.';
    return { decision: 'block', reason };
  } catch { return null; }
}
