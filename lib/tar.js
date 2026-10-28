/*
 * Just enough of the tar format (ustar) to write and read LiveGenie backups:
 * regular files with short names. Any tar tool can open the result.
 */
'use strict';

const fs = require('fs');

function octal(n, len) {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

function header(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 99) throw new Error('Name too long for tar: ' + name);
  h.write(name, 0, 'utf8');
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(mtime / 1000), 12), 136);
  h.write('        ', 148);              // checksum field counts as spaces while summing
  h.write('0', 156);                     // regular file
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** files: [{ name, path }] -> writes outFile */
function write(outFile, files) {
  const fd = fs.openSync(outFile, 'w');
  try {
    for (const f of files) {
      const st = fs.statSync(f.path);
      fs.writeSync(fd, header(f.name, st.size, st.mtimeMs));
      const data = fs.readFileSync(f.path);
      fs.writeSync(fd, data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) fs.writeSync(fd, Buffer.alloc(pad, 0));
    }
    fs.writeSync(fd, Buffer.alloc(1024, 0));
  } finally {
    fs.closeSync(fd);
  }
}

/** Returns [{ name, data }] for the regular files in a tar file. Throws on a damaged file. */
function read(file) {
  const buf = fs.readFileSync(file);
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    const want = parseInt(h.toString('ascii', 148, 156).replace(/\0.*$/, '').trim(), 8);
    if (sum !== want) throw new Error('This is not a LiveGenie backup (bad tar header)');
    const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(h.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    off += 512;
    if (off + size > buf.length) throw new Error('The backup file is cut short');
    if (type === '0' || type === '\0') out.push({ name, data: buf.subarray(off, off + size) });
    off += size + ((512 - (size % 512)) % 512);
  }
  return out;
}

module.exports = { write, read };
