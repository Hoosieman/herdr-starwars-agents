// Finds the Claude Code session behind a terminal. No Herdr imports, so `node --test` can load this file.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Claude Code's config folder, under home. Someone who moved it with CLAUDE_CONFIG_DIR changes this line.
const CLAUDE_DIR = ".claude";

export function parseSession(text, dir) {
  try {
    const s = JSON.parse(text);
    if (!SESSION_ID.test(s?.sessionId ?? "")) return null;
    return { dir, sessionId: s.sessionId, startedAt: s.startedAt ?? 0 };
  } catch { return null; }
}

// What `hc get <terminal> --json` says, or null.
export async function terminalFacts({ hc }, terminal) {
  const got = await hc(["get", terminal, "--json"]).catch(() => null);
  if (got?.code !== 0) return null;
  try { return JSON.parse(got.stdout); } catch { return null; }
}

// Windows: herdr-core reports the shell (pwsh) as the foreground process, and claude.exe runs as its child, so
// `sessions/<shell pid>.json` never exists. Shell pid -> claude.exe pid, looked up once and re-checked on a miss.
const childPids = new Map();

async function claudeChild(exec, pid) {
  if (!exec) return null;
  const query = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid} AND Name='claude.exe'" | Select-Object -First 1).ProcessId`;
  const r = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { timeout: 8000 }).catch(() => null);
  const child = Number.parseInt(String(r?.stdout ?? "").trim(), 10);
  return Number.isInteger(child) && child > 0 ? child : null;
}

// `<config folder>/sessions/<pid>.json` names the session a Claude Code process is running. No file means no session.
export async function findSession({ readTextFile, home, exec }, facts) {
  const pid = facts?.foreground?.pid;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const dir = `${home()}/${CLAUDE_DIR}`;
  const read = (p) => readTextFile(`${dir}/sessions/${p}.json`).catch(() => null);
  let text = await read(pid);
  if (!text && childPids.has(pid)) text = await read(childPids.get(pid));
  if (!text) {
    const child = await claudeChild(exec, pid);
    if (child) { childPids.set(pid, child); text = await read(child); } else childPids.delete(pid);
  }
  return text ? parseSession(text, dir) : null;
}
