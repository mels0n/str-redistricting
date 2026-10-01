# 0001. Record architecture decisions

- Status: accepted
- Date: 2026-10-01

## Context
Decisions get made once and questioned repeatedly. Without a record, the
reasoning lives only in whoever was present, and agent sessions have no
access to it at all. The predictable failure is a later session confidently
reintroducing an approach that was already considered and rejected.

## Decision
Every non-obvious decision in this repo gets an ADR here, numbered
sequentially, using `TEMPLATE.md`. Accepted ADRs are immutable; a changed
decision gets a new ADR that supersedes the old one rather than an edit.

## Alternatives rejected
- **Document decisions in the README** — mixes reference with explanation, and
  the README is read for how-to-run, not why.
- **Rely on commit messages and PR threads** — the reasoning is there but
  unfindable months later, and never surfaces in an agent's context.
- **No record** — the status quo that produced this ADR.

## Consequences
A small per-decision cost, paid at the moment the reasoning is freshest. In
return, `docs/adr/` becomes the first thing to read before proposing an
architectural change, for humans and agents alike.
