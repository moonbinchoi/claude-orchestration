// narrow-questions: the model pick asked as several narrow Noul questions, and the code rule that joins the answers.
import { INSTRUCTIONS } from './jev-tier.mjs';
import { ROLE } from './main-pick.mjs';

// the Noul band of jev-usage.md, not tuned on labels: an answer inside it reads toward the higher model
const HARD_ABOVE = 0.30;
const EASY_FROM = 0.70;

const noul = (prefix, sentences) => Object.fromEntries(Object.entries(sentences).map(([k, s]) => [k, { type: 'noul', instructions: prefix + s + INSTRUCTIONS }]));

// the first question of each set is the easy one; the rest are difficulty signals
export const ROUTER_NARROW = noul('', {
  specified: 'The brief fixes every step: the work is running commands, exact edits, file operations, or collecting matches into a fixed format.',
  cross_module: 'The work needs design or root-cause reasoning across several modules or documents.',
  open_review: 'The work is an open-ended correctness review with no given checklist.',
  irreversible: 'The work includes a risky or hard-to-reverse decision.',
});

export const MAIN_NARROW = noul(ROLE.trim() + ' ', {
  relay_only: 'The work is simple and fully specified, so the main session only relays it and checks the result.',
  ambiguous_scope: 'The scope of the work is ambiguous and the main session must settle it.',
  design_decisions: 'The main session must make design decisions.',
  many_parts: 'The work has many interacting parts to coordinate.',
  irreversible: 'The work includes a risky or irreversible step.',
});

const SETS = { specified: ROUTER_NARROW, relay_only: MAIN_NARROW };

// easy: 'specified' (router set) or 'relay_only' (main set). A missing or invalid answer reads as 0.5.
export function combine(answers, easy) {
  const p = Object.fromEntries(Object.keys(SETS[easy]).map((k) => {
    const v = answers?.[k]?.noul;
    return [k, typeof v === 'number' && Number.isFinite(v) ? v : 0.5];
  }));
  const hard = Object.keys(p).filter((k) => k !== easy && p[k] > HARD_ABOVE);
  if (hard.length) return { model: 'opus', answers: p, decided_by: hard };
  return { model: p[easy] >= EASY_FROM ? 'haiku' : 'sonnet', answers: p, decided_by: [easy] };
}
