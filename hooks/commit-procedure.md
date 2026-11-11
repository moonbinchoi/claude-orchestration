# Commit procedure

## All repositories
- Message: subject `<area>: <summary>` in the imperative, blank line, body, blank line, then the `Co-Authored-By` trailer the system reminder gives.
- Start the body with what the user wanted from this change: the problem and the goal, from the user's request, or from intent.md Problem and Goals when a design folder exists. Then add what changed if the subject does not say it. A reader of the log alone should be able to follow why the code was developed.
- Write the change story in the commit message. Instruction files (rules, agents, skills, docs, memory) hold current instructions only.
- Put the trailer in `-m` or a heredoc. The commit guard rejects a commit whose `-m`, heredoc, and `-F` file lack it, including `--amend --no-edit`, `-C`, and `--fixup`.

## ~/.claude
- Commit on `main`, the default branch.
- In a code commit, put `Work unit: E:/Claude/orchestration/docs/design/<YYYY-MM-DD-slug>` after the body, before the trailer.
- Do not stage the top-level `model` and `effortLevel` lines of settings.json or any settings.json line that mentions sdlc; the working tree keeps them dirty on purpose. To stage only the intended settings.json change:
  ```sh
  cd ~/.claude && t="$(mktemp)" && git show HEAD:settings.json > "$t"
  # apply only the intended change to "$t" with the Edit tool
  git update-index --cacheinfo 100644,"$(git hash-object -w "$t")",settings.json && git diff --cached -- settings.json
  ```
- Hand force pushes, branch renames, default-branch changes, and other destructive git commands to the user as exact commands that start with `cd`. Afterwards verify with read-only `gh api` or `gh repo view`.
- Check that `git config core.hooksPath` prints `hooks/git`. If not, run `git config core.hooksPath hooks/git`; a fresh clone does not carry it.
