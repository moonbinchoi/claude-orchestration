import assert from 'node:assert/strict';
import { isRunCommand } from './run-command.mjs';

let failed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('leading program decides: runs', () => {
  for (const c of ['node a.test.mjs', 'node --test', 'node --test a.test.mjs', 'npm test', 'pnpm run build', 'yarn lint', 'bun test', 'pytest -q', 'go test ./...', 'cargo test', 'dotnet test', 'mvn verify', './gradlew build', 'tsc --noEmit', 'cd /x && node a.test.mjs', 'CI=1 npm test', 'echo hi; npm run lint', 'echo x | node --test', String.raw`C:\tools\node.exe a.test.mjs`]) assert.ok(isRunCommand(c), c);
});
test('other runners: python -m pytest, uv run, npx/uvx/pnpm dlx, shell -c, loops', () => {
  for (const c of ['python -m pytest', 'python3 -m pytest -q', 'uv run pytest', 'npx vitest run', 'npx -y jest', 'uvx pytest', 'pnpm dlx eslint .', 'bash -c "npm test"', "sh -c 'cd x && npm test'", 'powershell -Command "npm test"', 'for f in a b; do node $f.test.mjs; done']) assert.ok(isRunCommand(c), c);
});
test('leading program decides: mentions are not runs', () => {
  for (const c of ['grep foo a.test.mjs', 'cat a.test.mjs', 'git add a.test.mjs', 'ls', 'npm install', 'node build.mjs', 'echo npm test', 'git commit -m "a; npm test"', 'echo "npm test"', 'python script.py', 'bash -c "ls"', 'go build', '', undefined]) assert.ok(!isRunCommand(c), String(c));
});

for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split('\n')[0]}`); }
}
process.exit(failed ? 1 : 0);
