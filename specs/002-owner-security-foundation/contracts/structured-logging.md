# Structured Logging Contract

## Configuration

| Variable | Allowed values | Default | Meaning |
| --- | --- | --- | --- |
| `MYOWNNOTION_LOG_LEVEL` | Pino levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`) | `info` | Minimum emitted severity |
| `MYOWNNOTION_LOG_COLOR` | `auto`, `always`, `never` | `auto` | Color policy for human output |

Invalid values refuse logger creation with a message naming the variable and
allowed values, never secret or request data.

## Output modes

- `auto` + TTY: compact single-line human output with a timestamp, colored
  severity, message, and safe structured context.
- `auto` + non-TTY: one JSON object per line, with no ANSI escape sequence.
- `always`: compact human output with color, for a destination known to support
  ANSI.
- `never` + TTY: the same compact human output without color.
- `never` + non-TTY: newline-delimited JSON.

All modes write through process standard streams. Compose does not persist or
rotate application-owned log files.

## Safe fields and developer use

Every API record carries the Pino level/time fields plus `service=api` and the
safe runtime environment. Request logs may carry only request ID, method, path,
and response status/duration. Authorization, cookies, bodies, payloads,
documents, names, snapshots, credentials, tokens, kits, and key material are
redacted or omitted by the shared factory.

Feature code MUST use the logger already exposed by Fastify (`request.log`,
`reply.log`, or `app.log`). It MUST NOT instantiate another logger, call
`console.*` for server events, interpolate private values into messages, or
disable the shared redaction/serializers. Add structured safe context as the
first argument and a stable message as the second.

```ts
request.log.info({ itemId, operation: "move" }, "content item moved");
```

Tests that need silence pass the existing `logger: false` application option;
tests of logging inject destination/TTY state through the logging factory.
