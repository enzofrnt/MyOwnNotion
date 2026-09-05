# Data model

No new persisted entities. Domain block remains `type: code`, `id`, `text`, and
optional `language` within its canonical document. BlockNote projection remains
`type: codeBlock`, `props.language`, and plain `content`. Alias normalization is
used only for grammar lookup. Neither theme, token styles nor copy state enters
history, sync, exports or storage. No migration is necessary.

Copy state: idle → copying → copied/failed → idle; timer cleanup on unmount.
Changing source clears obsolete feedback. Copy retries do not modify source.

Native mobile line break input is translated into one plain newline transaction
through the same editor adapter. It introduces no extra persisted field or
alternative history. Clipboard labels reuse the existing French copy strings.
