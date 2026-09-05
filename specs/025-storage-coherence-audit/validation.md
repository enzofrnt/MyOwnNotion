# Validation: storage privacy and coherence

2026-09-05: specification, plan, research, data model, boundary contract and
41 implementation tasks exist. Spec Kit prerequisites and all local document
links pass. Cross-artifact analysis maps every FR/SC with no blocking issue.
The requirements checklist is 16/16 complete. T001 initial evidence inventory
and T002 directly affected shared-artifact references are complete.

T003 implements pure authenticated file-inventory shape rules. All 29 focused
tests and the domain strict type check pass, including 200 generated shape/tail
removal cases up to 2 GiB, malformed provenance, empty files and mixed historical
chunk generations. This is shape validation, not ciphertext or runtime privacy
proof. Source findings and pending proof are explicit in the audit inventory.
Desktop and backup delivery remain separate active work. No user data/keys/live
service was changed by this preparation. Full local/PR/main gates remain pending.

T004 adds reviewed 0015 schema without running it on user data. The 13 focused
migration tests pass, including preservation of historical file UUID/digest and
acknowledged upload offset, format-specific null/lookup guards, invalid chunk
position/length/generation, cascading partial references, and durable transition
backup/replacement/retained-quarantine constraints. Database strict types pass.
Existing legacy candidate/export readers explicitly refuse unresolved encrypted
metadata until T013–T017 connect the protected runtime; no nullable digest is
misreported as an empty digest. The application transition is not implemented yet.
