// outbound: prepare one piece of text for Jev. Redact, cap at 200 chars, then reject CJK, guard() hits and path/url/email leftovers.
// guard() tolerates a few non-ASCII letters; text sent to Jev must have no CJK text at all.
import { guard } from './jev-tier.mjs';
import { redact } from './failure-cause.mjs';
import { PATH_URL_EMAIL } from './guard-common.mjs';

export const CJK = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export const CAP = 200;

// Returns { text, bad }: bad is a rule name, or null when the text may be sent.
export function outbound(s) {
  const text = redact(s).slice(0, CAP);
  return { text, bad: (CJK.test(text) ? 'cjk' : null) ?? guard(text) ?? (PATH_URL_EMAIL.test(text) ? 'path_url_email' : null) };
}
