import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "../../../test/harness.mjs";
import {
  readSessionTranscriptLink,
  removeSessionTranscriptLink,
  sessionLinkPath,
  writeSessionTranscriptLink
} from "../src/session-transcript-link.js";

test("write then read round-trips a session's transcript path", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  const transcriptPath = "D:\\proj\\.claude\\projects\\D--proj\\abc.jsonl";

  const wrote = writeSessionTranscriptLink({ sessionDir, sessionId: "sess_a", transcriptPath });
  assert.equal(wrote, true);
  assert.equal(readSessionTranscriptLink({ sessionDir, sessionId: "sess_a" }), transcriptPath);
});

test("two sessions in the same dir keep separate, independent links", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_a", transcriptPath: "/p/a.jsonl" });
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_b", transcriptPath: "/p/b.jsonl" });

  // The core of the bug fix: each session resolves ONLY its own transcript.
  assert.equal(readSessionTranscriptLink({ sessionDir, sessionId: "sess_a" }), "/p/a.jsonl");
  assert.equal(readSessionTranscriptLink({ sessionDir, sessionId: "sess_b" }), "/p/b.jsonl");
});

test("reading a session with no link returns undefined (no guessing)", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  assert.equal(readSessionTranscriptLink({ sessionDir, sessionId: "missing" }), undefined);
});

test("write is a no-op without the required fields", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  assert.equal(writeSessionTranscriptLink({ sessionDir, sessionId: "s" }), false);
  assert.equal(writeSessionTranscriptLink({ sessionDir, transcriptPath: "/p/a.jsonl" }), false);
  assert.equal(writeSessionTranscriptLink({ sessionId: "s", transcriptPath: "/p/a.jsonl" }), false);
});

test("remove deletes the link and is safe when it is already gone", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  writeSessionTranscriptLink({ sessionDir, sessionId: "sess_a", transcriptPath: "/p/a.jsonl" });
  const path = sessionLinkPath(sessionDir, "sess_a");
  assert.equal(existsSync(path), true);

  removeSessionTranscriptLink({ sessionDir, sessionId: "sess_a" });
  assert.equal(existsSync(path), false);
  // Second removal must not throw.
  removeSessionTranscriptLink({ sessionDir, sessionId: "sess_a" });
});

test("a corrupt link file reads as undefined rather than throwing", () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "sess-"));
  writeSessionTranscriptLink(
    { sessionDir, sessionId: "sess_a", transcriptPath: "/p/a.jsonl" },
    { writeFileSync: () => {} } // pretend write; nothing on disk
  );
  // Inject a reader returning junk to simulate a partially-written file.
  assert.equal(
    readSessionTranscriptLink({ sessionDir, sessionId: "sess_a" }, { readFileSync: () => "{not json" }),
    undefined
  );
});
