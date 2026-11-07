import assert from 'node:assert';
import path from 'node:path';
import { targetDir } from './frontmatter-validate.mjs';

const j = (...p) => path.join(...p);
assert.equal(targetDir('C:/Users/x/.claude/agents/worker.md'), j('C:/Users/x/.claude/agents'));
assert.equal(targetDir('E:/repo/.claude/agents/sub/a.md'), null); // only direct children are agents
assert.equal(targetDir('E:/repo/.claude/skills/prepare-lesson/SKILL.md'), j('E:/repo/.claude/skills'));
assert.equal(targetDir('E:/repo/plugins/p/skills/s/SKILL.md'), j('E:/repo/plugins/p/skills'));
assert.equal(targetDir('E:/repo/.claude/skills/s/notes.md'), null);
assert.equal(targetDir('E:/repo/docs/agents.md'), null);
assert.equal(targetDir('E:/repo/README.md'), null);
assert.equal(targetDir(undefined), null);
console.log('frontmatter-validate: ok');
