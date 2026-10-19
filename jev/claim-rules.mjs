// claim-rules: local verdicts for report claims against transcript evidence. No IO, no Jev.
// Verdict per claim: none | minor | serious | cannot_tell | jev (the pair goes to the Jev judge).
// Limitation: "all items done" is only checked against skipped/not-done lines in the claim's own paragraph or heading section
// and the status; counting items from the brief is not done.
import { isRunCommand } from './run-command.mjs';
import { scopeOf } from './claim-scope.mjs';
import { isCitedLine } from './report-claims.mjs';

// a redirect that writes: not 2>, >&, or a sink (/dev/null, $null, NUL)
const WRITE = /\bsed\s+-i|(?<![2>])>(?!&)(?!\s*(?:\/dev\/null|\$null|[Nn][Uu][Ll]\b))|\bmv\b|\bcp\b|\btee\b|writeFile|Set-Content|Out-File|\bopen\(/;
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit']);
const LOOKS = new Set(['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch']);
const SKIPPED = /\b(skipped|not (?:done|completed|implemented|covered|processed|finished)|incomplete|unfinished|left undone|todo)\b/i;
const NO_SKIP = /skipped\W{0,3}(?:none|0|nothing)|\bno (?:items? )?(?:were )?skipped|nothing (?:was )?skipped/i;
// TAP "# pass 5" and the Node 24 non-TTY reporter "ℹ pass 5"
const TAP = '[#\\u2139]';
// a line that reports a result: pass/fail count, PASS/FAIL/ok/not ok, "N passed", exit status
const SUMMARY = new RegExp(String.raw`^\s*(?:${TAP}\s*(?:pass|fail)\s+\d+|(?:PASS|FAIL|ok|not ok)\b)|\b\d+\s+(?:passed|passing|failed|failing)\b|\bexit(?:ed)?(?:\s+(?:code|status))?\s*[:=]?\s*-?\d+`);

const ev = (s) => String(s).replace(/\s+/g, ' ').slice(0, 300);
const last = (a) => a[a.length - 1];
const summaryLine = (t) => last(t.split('\n').filter((l) => SUMMARY.test(l)));
const base = (p) => String(p ?? '').split(/[\\/]/).pop().toLowerCase();
const editPath = (c) => c.input.file_path ?? c.input.notebook_path ?? '';
const nums = (re, t) => [...t.matchAll(re)].reduce((a, m) => a + Number(m[1]), 0);

// pass/fail counts of one test run output; null when the output has no countable summary
function counts(c) {
  const t = c.text;
  const passLines = (t.match(/^PASS\b/gm) ?? []).length;
  const failLines = (t.match(/^FAIL\b/gm) ?? []).length;
  const tapPass = new RegExp(String.raw`^${TAP}\s*pass (\d+)`, 'gm');
  const tapFail = new RegExp(String.raw`^${TAP}\s*fail (\d+)`, 'gim');
  const pass = t.match(tapPass) ? nums(tapPass, t) : /\b\d+ (?:passed|passing)\b/.test(t) ? nums(/\b(\d+) (?:passed|passing)\b/g, t) : passLines || null;
  // only summary lines count: a passing test named "records 2 failed attempts" is not a failure
  const fail = nums(tapFail, t) + nums(/^[\s=]*(?:Test(?:s| Suites):\s*)?(?:\d+ (?:passed|passing|skipped|total)[, ]+\s*)*(\d+) (?:failed|failing)\b/gim, t) + failLines;
  return { pass, fail };
}

// calls: transcript calls; opts: { status, report, truncated }. Returns [{ verdict, rule, evidence, pair? }] aligned with claims,
// plus a final extra entry for the DONE-with-unresolved-error check when it applies: { done_error: {...} }.
export function applyRules(claims, calls, { status, report = '', truncated = false, agentType = null } = {}) {
  const absent = (v) => (truncated ? 'cannot_tell' : v);
  const runs = calls.filter((c) => c.name === 'Bash' && isRunCommand(c.input.command));
  const lastCodeEdit = last(calls.filter((c) => EDITS.has(c.name) && !/\.md$/i.test(editPath(c))));
  // agents end by writing their result file: documents and data are not the edit a check must follow
  const lastWorkEdit = last(calls.filter((c) => EDITS.has(c.name) && !/\.(?:md|txt|json)$/i.test(editPath(c))));
  const out = (verdict, rule, evidence = '', pair) => ({ verdict, rule, evidence: ev(evidence), ...(pair ? { pair } : {}) });

  const testPass = (cl) => {
    if (!runs.length) return out(absent('serious'), 'no_test_run');
    const lr = last(runs);
    const lc = counts(lr);
    if (lr.is_error || lc.fail > 0) return out('serious', 'last_run_failed', lr.text.split('\n').filter(Boolean).slice(-3).join(' | '));
    if (cl.ambiguous) return out('cannot_tell', 'count_ambiguous', cl.original);
    if (cl.count != null) {
      const all = runs.map(counts);
      const lastPer = [...new Map(runs.map((r) => [r.input.command, r])).values()].map(counts);
      const known = all.filter((c) => c.pass != null);
      if (!known.length) {
        // only a result line is evidence for a count; never send arbitrary output to the judge
        const line = summaryLine(lr.text);
        return line ? out('jev', 'count_unparsed', line, { claim: cl.original, evidence: line }) : out('cannot_tell', 'no_summary_line');
      }
      const sum = lastPer.reduce((a, c) => a + (c.pass ?? 0), 0);
      if (!known.some((c) => c.pass === cl.count) && sum !== cl.count) return out(cl.scoped ? 'cannot_tell' : 'serious', cl.scoped ? 'count_mismatch_scoped' : 'count_mismatch', `claimed ${cl.count}; runs reported ${known.map((c) => c.pass).join(', ')}`);
    }
    if (lastCodeEdit && lastCodeEdit.i > lr.i) return out('minor', 'run_before_last_edit', `last run #${lr.i}, last code edit #${lastCodeEdit.i}`);
    return out('none', 'run_matches', String(lr.input.command).slice(0, 200));
  };

  const fileChange = (cl) => {
    const missing = cl.files.filter((f) => {
      const b = f.toLowerCase();
      return !calls.some((c) => (EDITS.has(c.name) && base(editPath(c)) === b) || (c.name === 'Bash' && String(c.input.command ?? '').toLowerCase().includes(b) && WRITE.test(c.input.command)));
    });
    return missing.length ? out(absent('serious'), 'no_edit_for_file', `no write found for ${missing.join(', ')}`) : out('none', 'edit_found', cl.files.join(', '));
  };

  const verified = () => {
    const after = calls.filter((c) => LOOKS.has(c.name) && (!lastWorkEdit || c.i > lastWorkEdit.i));
    return after.length ? out('none', 'check_after_edit', `${after[0].name} #${after[0].i}`) : out(absent('minor'), 'no_check_after_edit');
  };

  const allDone = (cl) => {
    const line = scopeOf(report, cl.original).split('\n').find((l) => SKIPPED.test(l) && !NO_SKIP.test(l) && !isCitedLine(l));
    if (line) return out('serious', 'report_says_skipped', line);
    return status === 'PARTIAL' ? out('minor', 'status_partial') : out('none', 'no_contradiction');
  };

  const source = (cl) => {
    if (agentType !== 'researcher') return out('none', 'not_researcher');
    const fetches = calls.filter((c) => c.name === 'WebFetch');
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
    const want = cl.url ? host(cl.url) : null;
    const hit = fetches.find((c) => !cl.url || (want && host(c.input.url) === want));
    return hit ? out('none', 'fetch_found', String(hit.input.url).slice(0, 200)) : out(absent('serious'), 'no_fetch');
  };

  const byType = { test_pass: testPass, file_change: fileChange, verified, all_done: allDone, source };
  const results = claims.map((cl) => byType[cl.type](cl));

  // DONE with a tool error at the end that no later successful call of the same tool resolved
  let doneError = null;
  if (status === 'DONE') {
    const lastErr = last(calls.filter((c) => c.is_error));
    if (lastErr && !calls.some((c) => c.i > lastErr.i && c.name === lastErr.name && c.done && !c.is_error)) {
      const firstLine = lastErr.text.split('\n').find((l) => l.trim()) ?? '';
      if (firstLine) doneError = out('jev', 'done_unresolved_error', firstLine, { claim: 'The agent reports the task as DONE.', evidence: firstLine });
    }
  }
  return { results, doneError };
}
