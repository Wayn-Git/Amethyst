"""Read one string value out of JSON that has not finished arriving.

Tool arguments reach us a few characters at a time. For most tools that does
not matter -- the call cannot be dispatched until the whole object is there --
but `create_artifact` carries an entire document in its `content` field, and
waiting for the closing brace means the panel sits empty for as long as the
model takes to write the file.

So this reads the value of one key out of a prefix of a JSON object, and is
willing to be handed something that stops mid-token:

    {"path": "notes.md", "content": "# Notes\\n\\nFirst para

The rules it has to respect are all about not lying to the caller:

* Never return a partially-decoded escape. `\\u00e9` arrives as six separate
  characters; emitting after `\\u00` would put a literal backslash-u-zero-zero
  on screen and then have to take it back.
* Never mistake an escaped quote for the end of the string. `"it\\"s"` is one
  value, not two.
* Only ever grow. The caller streams the difference between successive calls,
  so a shorter answer than last time would mean deleting text the reader has
  already seen.

Deliberately not a JSON parser. It does not validate, it does not build an
object, and it has no opinion about anything outside the key it was asked for.
Once the arguments are complete the caller uses `json.loads` like always;
this only exists to have something to show in the meantime.
"""

from __future__ import annotations

# Characters that mean something other than themselves after a backslash.
_SIMPLE_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


def _find_key(raw: str, key: str) -> int | None:
    """Index just past the opening quote of `key`'s string value, or None.

    Scans rather than regexes because the key name can legally appear inside an
    earlier *value* -- a document about `create_artifact` may well contain the
    word "content" -- and only a scan that knows which quotes are inside a
    string can tell the difference.
    """
    needle = f'"{key}"'
    at = 0
    in_string = False
    escaped = False

    while at < len(raw):
        char = raw[at]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            at += 1
            continue

        if char == '"':
            # A key is a string in value position followed by a colon. Compare
            # here, before stepping into the string, so the scan sees it whole.
            if raw.startswith(needle, at):
                after = at + len(needle)
                while after < len(raw) and raw[after] in " \t\r\n":
                    after += 1
                if after < len(raw) and raw[after] == ":":
                    after += 1
                    while after < len(raw) and raw[after] in " \t\r\n":
                        after += 1
                    # Only a string value is streamable. A number or an object
                    # under this key is not what we were promised.
                    if after < len(raw) and raw[after] == '"':
                        return after + 1
                    return None
            in_string = True
            at += 1
            continue

        at += 1

    return None


def partial_string(raw: str, key: str) -> str:
    """As much of `raw`'s `key` value as can be decoded without guessing.

    Returns "" when the key has not arrived yet, or when nothing after it can
    be decoded with certainty. Never raises: a malformed prefix is a prefix
    that has not finished, not an error.
    """
    start = _find_key(raw, key)
    if start is None:
        return ""

    out: list[str] = []
    at = start

    while at < len(raw):
        char = raw[at]

        if char == '"':
            break  # The value ended; everything before this is final.

        if char != "\\":
            out.append(char)
            at += 1
            continue

        # An escape, which may be cut in half by the end of what has arrived.
        if at + 1 >= len(raw):
            break
        marker = raw[at + 1]

        if marker in _SIMPLE_ESCAPES:
            out.append(_SIMPLE_ESCAPES[marker])
            at += 2
            continue

        if marker == "u":
            # Four hex digits, or nothing. Stopping here is what keeps a
            # half-arrived `\u00e` off the screen.
            if at + 6 > len(raw):
                break
            try:
                point = int(raw[at + 2 : at + 6], 16)
            except ValueError:
                break

            # Anything outside the BMP is written as a surrogate pair, and half
            # a pair is not a character -- it is not even valid text. So a high
            # surrogate is withheld until its partner arrives, which is the same
            # rule as half an escape, one level up. An emoji is the common case.
            if 0xD800 <= point <= 0xDBFF:
                if at + 12 > len(raw) or raw[at + 6 : at + 8] != "\\u":
                    break
                try:
                    low = int(raw[at + 8 : at + 12], 16)
                except ValueError:
                    break
                if not 0xDC00 <= low <= 0xDFFF:
                    break
                out.append(chr(0x10000 + ((point - 0xD800) << 10) + (low - 0xDC00)))
                at += 12
                continue

            # A low surrogate with nothing before it is malformed, not partial.
            if 0xDC00 <= point <= 0xDFFF:
                break

            out.append(chr(point))
            at += 6
            continue

        # An escape the format does not define. Stop rather than invent.
        break

    return "".join(out)
