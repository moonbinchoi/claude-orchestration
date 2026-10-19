// report-fixtures: build subagent transcript jsonl text for the report-guard tests.
// steps: [name, input, resultText, isError] -> assistant tool_use line + user tool_result line. Also adds an api-request-blob
// duplicate line, as real transcripts have, to prove it is ignored.
export function transcript(brief, steps = []) {
  const out = [JSON.stringify({ type: 'user', message: { role: 'user', content: brief } })];
  steps.forEach(([name, input, result = 'ok', isError = false], i) => {
    const use = { type: 'tool_use', id: `t${i}`, name, input };
    out.push(JSON.stringify({ type: 'assistant', message: { content: [use] } }));
    out.push(JSON.stringify({ type: 'api-request-blob', message: { content: [use] } }));
    out.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: [{ type: 'text', text: result }], is_error: isError }] } }));
  });
  return out.join('\n') + '\n';
}
