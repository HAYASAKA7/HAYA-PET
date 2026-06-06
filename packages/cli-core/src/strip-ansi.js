// Removes ANSI/VT escape sequences (CSI, OSC, and single-char escapes) that a
// PTY emits, so the output observer matches against plain text. Newlines are
// preserved for line splitting.
const ANSI_PATTERN = new RegExp(
  [
    // OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \
    "[\\u001B\\u009B]\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)",
    // CSI and other escape sequences
    "[\\u001B\\u009B][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]"
  ].join("|"),
  "g"
);

export function stripAnsi(input) {
  return String(input).replace(ANSI_PATTERN, "");
}
