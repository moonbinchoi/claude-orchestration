// Pure formatter: classifier answers -> one output line per question (spec "출력 줄").
const f2 = (n) => n.toFixed(2);

// options: [label, p] in criteria order; stable sort keeps criteria order on ties.
function ranked(q, a, label) {
  const keys = q.type === 'score' ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria);
  return keys.map((k) => [label(k), a.probabilities?.[k] ?? 0]).sort((x, y) => y[1] - x[1]);
}

export function formatItem(itemId, questions, companions, answers) {
  const lines = [];
  const top_p = [];
  const targetMarks = Object.create(null); // target question ID -> companion marks
  for (const [nid, target] of Object.entries(companions)) {
    const a = answers[nid];
    const mark = !a ? 'companion_missing' : a.noul < 0.7 ? 'no_option_fits' : null;
    if (mark) (targetMarks[target] ??= []).push(mark);
  }
  for (const [qid, q] of Object.entries(questions)) {
    const a = answers[qid];
    if (!a) { top_p.push(null); continue; }
    const id = `Jev ${itemId}.${qid}`;
    const marks = [];
    let body;
    if (q.type === 'noul') {
      top_p.push(a.noul);
      if (Object.hasOwn(companions, qid)) body = `p ${f2(a.noul)} companion of ${companions[qid]}`;
      else {
        body = `p ${f2(a.noul)}`;
        if (a.noul >= 0.7) body += ' yes';
        else if (a.noul <= 0.3) body += ' no';
        else marks.push('noul_band');
      }
    } else {
      const score = q.type === 'score';
      const [first, second] = ranked(q, a, (k) => (score ? `level ${k}` : k));
      top_p.push(first[1]);
      body = `${score ? `score ${f2(a.score)}, ` : ''}${first[0]} ${f2(first[1])} (${second[0]} ${f2(second[1])})`;
      if (first[1] < 0.6) marks.push('low_p');
    }
    marks.push(...(targetMarks[qid] ?? []));
    lines.push(`${id}: ${body}${marks.length ? `; unsure: ${marks.join(', ')}` : ''}`);
  }
  return { lines, top_p };
}
