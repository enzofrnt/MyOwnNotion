/** Owner-approved MCP exchange: secrets enter via a file and leave only in a new0600 file. */
import { open, readFile, unlink } from "node:fs/promises";
import process from "node:process";

export async function connectMcp(input: {
  server: string;
  codeFile: string;
  output: string;
}): Promise<void> {
  const server = new URL(input.server);
  if (
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    (server.protocol !== "https:" &&
      !(
        server.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)
      ))
  )
    throw new Error(
      "Use an HTTPS server origin, or HTTP on loopback, without credentials or query parameters.",
    );
  const code = (await readFile(input.codeFile, "utf8")).trim();
  if (!/^mn_exchange_[A-Za-z0-9_-]{43}$/.test(code))
    throw new Error("The exchange code file is invalid.");
  const output = await open(input.output, "wx", 0o600);
  let written = false;
  try {
    const response = await fetch(new URL("/mcp/exchange", server), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        "MCP exchange was refused. Create a new code in security settings if it expired or was already used.",
      );
    const body = (await response.json()) as { accessToken?: unknown; tokenType?: unknown };
    if (
      typeof body.accessToken !== "string" ||
      !/^mn_mcp_[A-Za-z0-9_-]{43}$/.test(body.accessToken) ||
      body.tokenType !== "Bearer"
    )
      throw new Error("The MCP server returned an invalid credential response.");
    await output.writeFile(
      `${JSON.stringify(
        {
          mcpServers: {
            myownnotion: {
              url: new URL("/mcp", server).href,
              headers: { Authorization: `Bearer ${body.accessToken}` },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await output.sync();
    written = true;
  } finally {
    await output.close();
    if (!written) await unlink(input.output);
  }
}
export async function runMcpConnect(
  argv: readonly string[],
  print: (line: string) => void,
): Promise<number> {
  if (argv.length === 0 || argv.includes("--help")) {
    print(
      "MCP connection: --server HTTPS_ORIGIN --code-file PATH --output NEW_PATH\nThe code is read from a file; credentials are written only to a new private configuration file.",
    );
    return 0;
  }
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      name === undefined ||
      !["--server", "--code-file", "--output"].includes(name) ||
      value === undefined ||
      options[name] !== undefined
    ) {
      print("Invalid arguments. Use --help.");
      return 2;
    }
    options[name] = value;
  }
  const server = options["--server"];
  const codeFile = options["--code-file"];
  const output = options["--output"];
  if (!server || !codeFile || !output) {
    print("All three options are required. Use --help.");
    return 2;
  }
  try {
    await connectMcp({ server, codeFile, output });
    print(
      "MCP configuration created. Keep that file private and remove the used exchange-code file.",
    );
    return 0;
  } catch {
    // A network, filesystem or JSON error can include user-supplied data.
    print(
      "MCP connection failed. Check the server, code expiry and that the output path is new. If the code was consumed, revoke that connection and create another.",
    );
    return 1;
  }
}
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.exitCode = await runMcpConnect(process.argv.slice(2), (line) =>
    process.stdout.write(`${line}\n`),
  );
}
