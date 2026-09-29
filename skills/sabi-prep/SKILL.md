---
name: sabi-prep
description: Prepare a coding task on free inference before doing it. Use when a task needs repository exploration first (finding the files involved, running the tests to see what fails, collecting constraints) and the user wants that groundwork done by a cheaper model through Sabi, or when the user asks for a Sabi brief. Runs a preparer harness in a disposable worktree and returns a checked brief to work from.
license: MIT
metadata:
  author: vizuh
  repository: https://github.com/vizuh/sabi
---

# Sabi prep

A brief pays off when exploring the task would cost real context: a large or unfamiliar repository, a failure whose cause is not obvious, several files to trace. For a small change in a few files you already know, do it directly; in a probe on a three-file repository, the briefed session used more turns than a cold one.

Sabi can hand the exploration part of a task to a cheaper model running in another harness (Hermes, OMP, pi or Prime Agent), in a disposable copy of the repository, and give you back a short brief. The point is to start the real work with the useful context instead of spending your own context rediscovering it.

## Running it

From the repository root:

```bash
sabi brief "<the task, in one or two sentences>" --preparer=hermes
```

It prints the path of `brief.md`. Preparation usually takes one to three minutes; run it in the background if you have other work. Preparer choices are `hermes`, `omp`, `pi` and `prime`; each must already be installed, and Sabi's proxy must be running (`sabi serve`).

## Working from the brief

- `<verified_facts>` were checked by Sabi against the files in this working tree: the quoted lines exist where the brief says.
- `<reported_results>` are command results from the preparer's copy. Sabi did not re-run them, so run the command yourself before relying on the output.
- `<proposed_path>` holds hypotheses. Treat them as a starting point to confirm, not as conclusions.
- `<uncertainties>` lists what could not be confirmed and why.
- Record what you verify in `state.json` next to the brief, and short notes in `progress.md`.

If the brief could not be built, the command says why and you can do the task directly.
