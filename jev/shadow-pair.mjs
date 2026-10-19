// shadow-pair: the claim/evidence pair to send to Jev for a claim the local rules already judged. No IO.
// An absence verdict has no evidence line, so a fixed English sentence names what was not found.
const FIXED = {
  no_test_run: 'No test or build command appears in the tool log.',
  no_check_after_edit: 'No Read, Grep or Bash call appears after the last edit.',
  no_summary_line: 'No test result summary line appears in the test output.',
  no_contradiction: 'The report lists no skipped or unfinished item.',
  status_partial: 'The report status is PARTIAL.',
  not_researcher: 'Only researcher agents are checked for source claims.',
};

// claim: extracted claim ({ original, url? }); result: its local verdict ({ rule, evidence })
export function shadowPair(claim, { rule, evidence }) {
  let e = FIXED[rule];
  if (rule === 'no_fetch') {
    let host = null;
    try { host = claim.url ? new URL(claim.url).hostname.replace(/^www\./, '') : null; } catch { /* no host */ }
    e = host ? `No WebFetch of ${host} appears in the tool log.` : 'No WebFetch call appears in the tool log.';
  }
  if (rule === 'no_edit_for_file') e = evidence.replace(/^no write found for (.*)$/, 'No Edit or Write call touched $1.');
  return { claim: claim.original, evidence: e ?? (evidence || 'No evidence line was recorded.') };
}
