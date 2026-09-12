# Data model: UI quality guidance

No application entities, persistence or state transitions change.

The versioned skill contains a unique `name`, a discovery `description` and
human-readable instructions. Workflow references resolve to this single file.
Feature-specific UI states and proof remain in each feature's own artifacts.
