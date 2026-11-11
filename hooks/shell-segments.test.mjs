import assert from 'node:assert';
import { segments } from './shell-segments.mjs';
const first = (c) => segments(c).map((s) => s.words[0]?.text);
const texts = (c, i = 0) => segments(c)[i].words.map((w) => w.text);

assert.deepEqual(first('a && b || c; d | e\nf & g'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
assert.deepEqual(first('(cd x && git status)'), ['cd', 'git']);
assert.deepEqual(texts(`git commit -m "a b" -m 'c d'`), ['git', 'commit', '-m', 'a b', '-m', 'c d']);
assert.deepEqual(texts('echo "x && y"'), ['echo', 'x && y']);
assert.deepEqual(texts('a\\ b'), ['a b']);
const w = segments('git commit --message="a b"')[0].words[2];
assert.deepEqual([w.text, w.bare], ['--message=a b', '--message=']);
assert.match(segments(`$env:CLAUDECODE=''`)[0].words[0].bare, /CLAUDECODE/);
assert.equal(segments(`git commit -m "CLAUDECODE"`)[0].words[3].bare, '');
// $(...) inside double quotes, with quotes, parens and a heredoc in it
const sub = texts(`git commit -m "$(cat <<'EOF'\nsay "hi" (1\nEOF\n)"`);
assert.equal(sub.length, 4);
assert.match(sub[3], /say "hi" \(1/);
// heredoc attached to its segment
const hd = segments(`git commit -F - <<'EOF'\nbody line\nEOF\necho after`);
assert.deepEqual(hd[0].heredocs, ['body line']);
assert.equal(hd[1].words[0].text, 'echo');
assert.deepEqual(segments('cat <<-EOF\n\tx\n\tEOF')[0].heredocs, ['\tx']);
// PowerShell here-string
assert.deepEqual(texts(`git commit -m @'\nl1\nl2\n'@`).slice(3), ['l1\nl2']);
// <<< here-string is not a heredoc
const hs = segments('git commit -F - <<< "msg"\ngit push --force');
assert.equal(hs.length, 2);
assert.deepEqual(hs[1].words.map((x) => x.text), ['git', 'push', '--force']);
assert.deepEqual(hs[0].heredocs, []);
// line continuation is dropped
assert.deepEqual(texts('git \\\n  commit -m "x"'), ['git', 'commit', '-m', 'x']);
assert.deepEqual(texts('git \\\r\n  commit'), ['git', 'commit']);
// comments do not open quotes
const cm = segments("git status # don't care\ngit push --force");
assert.deepEqual(cm.map((x) => x.words.map((y) => y.text).join(' ')), ['git status', 'git push --force']);
// PowerShell: backslash is literal, backtick escapes
const ps = segments('cd "C:\\repo\\"; git push --force', 'powershell');
assert.equal(ps[0].words[1].text, 'C:\\repo\\');
assert.deepEqual(ps[1].words.map((x) => x.text), ['git', 'push', '--force']);
const pc = segments('git push origin main `\n  --force', 'powershell');
assert.equal(pc.length, 1);
assert.equal(pc[0].words.at(-1).text, '--force');
assert.equal(segments('echo "a`"b"', 'powershell')[0].words[1].text, 'a"b');
console.log('shell-segments: ok');
