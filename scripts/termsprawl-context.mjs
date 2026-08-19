import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function isSafeProjectId(id) {
  return typeof id === "string" && PROJECT_ID_PATTERN.test(id);
}
const LINKS_DIR = "links";
const LINK_FILE_VERSION = 1;
const LINKS_ROOT = ".termsprawl";
function linksDir(cwd) {
  return join(cwd, LINKS_ROOT, LINKS_DIR);
}
function parseLinkFile(raw) {
  try {
    const parsed2 = JSON.parse(raw);
    if (parsed2.version !== LINK_FILE_VERSION) return null;
    if (!isSafeProjectId(parsed2.a) || !isSafeProjectId(parsed2.b)) return null;
    if (parsed2.a === parsed2.b) return null;
    return { a: parsed2.a, b: parsed2.b };
  } catch {
    return null;
  }
}
function listLinks(cwd) {
  const dir = linksDir(cwd);
  if (!existsSync(dir)) return [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const links = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      const pair = parseLinkFile(readFileSync(path, "utf8"));
      if (pair) links.push({ ...pair, path });
    } catch {
    }
  }
  return links;
}
function peersOf(cwd, id) {
  if (!isSafeProjectId(id)) return [];
  return listLinks(cwd).filter((link) => link.a === id || link.b === id).map((link) => link.a === id ? link.b : link.a);
}
const TRANSCRIPTS_DIR = "transcripts";
const INDEX_VERSION = 1;
function transcriptIndexFilePath(cwd, nodeId) {
  return join(cwd, ".termsprawl", TRANSCRIPTS_DIR, `${nodeId}.json`);
}
function readTranscriptPath(cwd, nodeId) {
  if (!isSafeProjectId(nodeId)) return null;
  try {
    if (!existsSync(transcriptIndexFilePath(cwd, nodeId))) return null;
    const parsed2 = JSON.parse(readFileSync(transcriptIndexFilePath(cwd, nodeId), "utf8"));
    if (parsed2.version !== INDEX_VERSION) return null;
    if (typeof parsed2.path !== "string" || parsed2.path.length === 0) return null;
    return parsed2.path;
  } catch {
    return null;
  }
}
const LINKED_TURN_MAX_CHARS = 2e3;
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = [];
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text") {
        const text = block.text;
        if (typeof text === "string") texts.push(text);
      }
    }
    if (texts.length === 0) return null;
    return texts.join("\n");
  }
  return null;
}
function readTranscriptTurns(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const turns = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const message = entry.message;
    if (!message || typeof message !== "object") continue;
    const content = message.content;
    const textVal = contentToText(content);
    if (textVal === null) continue;
    turns.push({ role: entry.type, text: textVal.slice(0, LINKED_TURN_MAX_CHARS) });
  }
  return turns.slice(-40);
}
function formatLinkedContext(opts) {
  const lines = [`# linked context from ${opts.peerTitle} (${opts.peerId})`];
  for (const turn of opts.turns) {
    lines.push(`## ${turn.role}`, turn.text);
  }
  return lines.join("\n");
}
function parseContextArgs(argv2) {
  let cwd = null;
  let self = null;
  for (let i = 0; i < argv2.length; i++) {
    const arg = argv2[i];
    if (arg === "--cwd") {
      cwd = argv2[++i];
      if (cwd === void 0) return { error: "missing value for --cwd" };
    } else if (arg === "--self") {
      self = argv2[++i];
      if (self === void 0) return { error: "missing value for --self" };
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (cwd === null || self === null) return { error: "expected --cwd and --self" };
  return { cwd, self };
}
function runContextCli(opts, io) {
  const peers = io.peers(opts.self);
  if (peers.length === 0) return 0;
  const blocks = [];
  for (const peer of peers) {
    const path = io.transcriptPath(peer);
    if (!path) continue;
    const turns = io.turns(path);
    if (turns.length === 0) continue;
    const title = io.nodeTitle(peer) ?? peer;
    blocks.push(formatLinkedContext({ peerId: peer, peerTitle: title, turns }));
  }
  if (blocks.length === 0) return 0;
  io.print(blocks.join("\n---\n"));
  return 0;
}
function createRealContextIO(cwd) {
  function nodeTitle(nodeId) {
    try {
      const parsed2 = JSON.parse(
        readFileSync(join(cwd, ".termsprawl", "project.json"), "utf8")
      );
      const node = (parsed2.nodes ?? []).find((n) => n.id === nodeId && n.data && typeof n.data === "object");
      const title = node?.data?.["title"];
      if (typeof title === "string") return title;
      return null;
    } catch {
      return null;
    }
  }
  return {
    peers: (self) => peersOf(cwd, self),
    transcriptPath: (nodeId) => readTranscriptPath(cwd, nodeId),
    nodeTitle,
    turns: (path) => readTranscriptTurns(path),
    print: (text) => console.log(text)
  };
}
const argv = process.argv.slice(2);
const parsed = parseContextArgs(argv);
if ("error" in parsed) {
  console.error(`termsprawl-context: ${parsed.error}`);
  process.exit(2);
}
process.exit(runContextCli(parsed, createRealContextIO(parsed.cwd)));
