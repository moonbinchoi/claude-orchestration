// transcript-read: read a subagent transcript file; only the last `max` bytes when it is larger.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

export const MAX_BYTES = 20 * 1024 * 1024;

// Returns { text, bytes, truncated }; throws when the file cannot be read.
export function readTail(path, max = MAX_BYTES) {
  const fd = openSync(path, 'r');
  try {
    const bytes = fstatSync(fd).size;
    const len = Math.min(bytes, max);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, bytes - len);
    return { text: buf.toString('utf8'), bytes, truncated: bytes > max };
  } finally { closeSync(fd); }
}
