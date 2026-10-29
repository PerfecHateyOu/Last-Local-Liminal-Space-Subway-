import { describe, expect, test } from 'bun:test';
import { inflateRawSync, crc32 } from 'node:zlib';
// @ts-expect-error plain .mjs build script
import { zip } from '../../scripts/zip.mjs';

/** Reads a zip back through its central directory. */
function unzip(buf: Buffer): Record<string, Buffer> {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < n; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = inflateRawSync(buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize));
    expect(data.length).toBe(size);
    expect(crc32(data) >>> 0).toBe(crc);
    out[name] = data;
    p += 46 + nlen;
  }
  return out;
}

describe('offline zip writer', () => {
  test('round-trips files with UTF-8 names and valid CRCs', () => {
    const html = Buffer.from('<!doctype html>' + 'x'.repeat(50000));
    const files = unzip(zip([['Last-Local/index.html', html], ['Last-Local/README — read me.txt', Buffer.from('hi')]]));
    expect(Object.keys(files)).toEqual(['Last-Local/index.html', 'Last-Local/README — read me.txt']);
    expect(files['Last-Local/index.html'].equals(html)).toBe(true);
  });
  test('compresses', () => {
    const big = Buffer.from('a'.repeat(100000));
    expect(zip([['a.txt', big]]).length).toBeLessThan(2000);
  });
});
