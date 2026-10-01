# docs

Diátaxis layout. Only `adr/` exists from day 1; create any other directory together with
its first document, never as an empty placeholder.

- `tutorials/` - Learning-oriented. A guided path for someone new, guaranteed to work start to finish.
- `how-to/` - Task-oriented. "How do I deploy to staging." Assumes competence, solves one problem.
- `reference/` - Information-oriented, and GENERATED. Never hand-write here: hand-maintained reference drifts and is discovered only when someone trusts it. Reference never explains.
- `explanation/` - Understanding-oriented. Why the system is shaped this way, trade-offs, context. Links to reference, never duplicates it.
- `adr/` - Numbered architecture decision records. Immutable once accepted; superseded rather than edited. Use TEMPLATE.md.
