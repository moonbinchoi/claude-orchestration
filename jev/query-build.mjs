// query-build: builds one Jev request whose state carries the summary plus whatever facts and attributes this call has.
import { guard } from './jev-tier.mjs';
import { parseAttributes } from './query-attributes.mjs';
import { computeFacts } from './query-facts.mjs';

// questions go in as given: what the state carries never changes what is asked
export function buildQuery({ alias, summary, questions, agentType, brief, attributesText, agentsDir }) {
  const rejected = guard(summary);
  if (rejected) return { rejected };
  const facts = computeFacts({ agentType, brief, agentsDir });
  const { attributes, dropped } = parseAttributes(attributesText);
  const state = { summary };
  if (Object.keys(facts).length) state.facts = facts;
  if (Object.keys(attributes).length) state.attributes = attributes;
  return { body: { model: alias, state, questions }, dropped };
}
