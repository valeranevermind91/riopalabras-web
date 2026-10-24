// The app's icon (public/favicon.svg, and the 512x512 avatar for BotFather), regenerated from its source: the letter R of Fraunces at weight 600 (the app's
// display face, the .brand rule of src/index.css), cream (--page) on teal (--teal), the colours read from src/tokens.css (the light theme, so the icon looks the
// same whatever theme the app is in). The letter is drawn as an outline (a <path>), so the favicon is small and needs no font.
//
//   node tools/icon/make-icon.mjs                          writes public/favicon.svg
//   node tools/icon/make-icon.mjs --avatar out.png         also renders the 512x512 PNG with headless Chrome (CHROME_PATH, or a Chrome in the usual places)
//
// The outline is read from tools/icon/fraunces-latin-600-normal.woff2 (SIL Open Font License, tools/icon/Fraunces-OFL.txt): the WOFF2 file is unpacked here
// (the Brotli stream, then the glyf table's transform), so nothing needs installing. tools/icon/make-icon.test.mjs checks that public/favicon.svg is exactly
// what this script makes from the font and the tokens, so the icon and its source cannot drift apart.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
export const FONT_FILE = path.join(HERE, 'fraunces-latin-600-normal.woff2')
export const SIZE = 512
/** The R is this fraction of the height of the square (its ink box, not the font's line): big enough for 32 px, small enough for a circular crop. */
export const LETTER_HEIGHT = 0.56

// ---- the tokens ----
export function readTokens(css = fs.readFileSync(path.join(ROOT, 'src', 'tokens.css'), 'utf8')) {
  const light = css.slice(css.indexOf(':root,'), css.indexOf(":root[data-theme='dark']"))
  const token = (name) => {
    const m = light.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
    if (!m) throw new Error(`token --${name} not found in the light theme of src/tokens.css`)
    return m[1].toLowerCase()
  }
  return { teal: token('teal'), page: token('page') }
}

// ---- WOFF2: just enough to read one glyph's outline (https://www.w3.org/TR/WOFF2/) ----
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill']

function readTables(buf) {
  if (buf.toString('ascii', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file')
  const numTables = buf.readUInt16BE(12)
  const compressedSize = buf.readUInt32BE(20)
  let pos = 48
  const base128 = () => {
    let v = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[pos++]
      v = v * 128 + (b & 0x7f)
      if (!(b & 0x80)) return v
    }
    throw new Error('bad UIntBase128')
  }
  const dir = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++]
    const idx = flags & 0x3f
    let tag
    if (idx === 63) { tag = buf.toString('ascii', pos, pos + 4); pos += 4 } else tag = KNOWN_TAGS[idx]
    const version = flags >> 6
    const origLength = base128()
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    const length = transformed ? base128() : origLength
    dir.push({ tag, origLength, length, transformed })
  }
  const data = zlib.brotliDecompressSync(buf.subarray(pos, pos + compressedSize))
  const tables = {}
  let off = 0
  for (const t of dir) { tables[t.tag] = { ...t, data: data.subarray(off, off + t.length) }; off += t.length }
  return tables
}

// The glyph's points, from the transformed glyf table. Every glyph before it has to be read through to keep the streams in step.
function readGlyph(glyfTable, gid) {
  const d = glyfTable.data
  const nGlyphs = d.readUInt16BE(4)
  const sizes = [8, 12, 16, 20, 24, 28, 32].map((o) => d.readUInt32BE(o))
  let at = 36
  const stream = (n) => { const s = { buf: d.subarray(at, at + n), pos: 0 }; at += n; return s }
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instrS] = sizes.map(stream)
  void bboxS; void instrS
  const u8 = (s) => s.buf[s.pos++]
  const u16 = (s) => { const v = s.buf.readUInt16BE(s.pos); s.pos += 2; return v }
  const u255 = (s) => { const c = u8(s); if (c === 253) return u16(s); if (c === 255) return 253 + u8(s); if (c === 254) return 506 + u8(s); return c }
  const signed = (flag, base) => (flag & 1 ? base : -base)
  for (let g = 0; g < nGlyphs; g++) {
    const nContours = nContourS.buf.readInt16BE(nContourS.pos); nContourS.pos += 2
    if (nContours === 0) { if (g === gid) return []; continue }
    if (nContours < 0) { // a composite: read its components through (the instructions too), to move the streams on
      let more = true, hasInstr = false
      while (more) {
        const flags = u16(compositeS); u16(compositeS)
        compositeS.pos += flags & 1 ? 4 : 2
        if (flags & 0x08) compositeS.pos += 2; else if (flags & 0x40) compositeS.pos += 4; else if (flags & 0x80) compositeS.pos += 8
        more = Boolean(flags & 0x20); hasInstr ||= Boolean(flags & 0x100)
      }
      if (hasInstr) { const n = u255(glyphS); instrS.pos += n }
      if (g === gid) throw new Error('the glyph is a composite')
      continue
    }
    const counts = Array.from({ length: nContours }, () => u255(nPointsS))
    const total = counts.reduce((a, b) => a + b, 0)
    const pts = []
    let x = 0, y = 0
    for (let i = 0; i < total; i++) {
      let flag = u8(flagS)
      const on = !(flag >> 7)
      flag &= 0x7f
      let dx, dy
      const b = (k) => glyphS.buf[glyphS.pos + k]
      if (flag < 10) { dx = 0; dy = signed(flag, ((flag & 14) << 7) + b(0)); glyphS.pos += 1 }
      else if (flag < 20) { dx = signed(flag, (((flag - 10) & 14) << 7) + b(0)); dy = 0; glyphS.pos += 1 }
      else if (flag < 84) { const b0 = flag - 20, b1 = b(0); dx = signed(flag, 1 + (b0 & 0x30) + (b1 >> 4)); dy = signed(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)); glyphS.pos += 1 }
      else if (flag < 120) { const b0 = flag - 84; dx = signed(flag, 1 + (Math.floor(b0 / 12) << 8) + b(0)); dy = signed(flag >> 1, 1 + ((((b0 % 12) >> 2)) << 8) + b(1)); glyphS.pos += 2 }
      else if (flag < 124) { const b2 = b(1); dx = signed(flag, (b(0) << 4) + (b2 >> 4)); dy = signed(flag >> 1, ((b2 & 0x0f) << 8) + b(2)); glyphS.pos += 3 }
      else { dx = signed(flag, (b(0) << 8) + b(1)); dy = signed(flag >> 1, (b(2) << 8) + b(3)); glyphS.pos += 4 }
      x += dx; y += dy
      pts.push({ x, y, on })
    }
    const n = u255(glyphS); instrS.pos += n // the glyph's instructions: not needed
    if (g === gid) {
      const contours = []
      let i = 0
      for (const c of counts) { contours.push(pts.slice(i, i + c)); i += c }
      return contours
    }
  }
  throw new Error('glyph not found')
}

function glyphIdOf(cmap, codePoint) {
  const d = cmap.data
  const n = d.readUInt16BE(2)
  for (let i = 0; i < n; i++) {
    const platform = d.readUInt16BE(4 + i * 8), encoding = d.readUInt16BE(6 + i * 8), off = d.readUInt32BE(8 + i * 8)
    const format = d.readUInt16BE(off)
    if (!((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0)) continue
    if (format === 4) {
      const segX2 = d.readUInt16BE(off + 6)
      const ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = d.readUInt16BE(ends + s * 2), start = d.readUInt16BE(starts + s * 2)
        if (codePoint < start || codePoint > end) continue
        const delta = d.readInt16BE(deltas + s * 2), range = d.readUInt16BE(ranges + s * 2)
        if (range === 0) return (codePoint + delta) & 0xffff
        const g = d.readUInt16BE(ranges + s * 2 + range + (codePoint - start) * 2)
        return g === 0 ? 0 : (g + delta) & 0xffff
      }
    } else if (format === 12) {
      const groups = d.readUInt32BE(off + 12)
      for (let g = 0; g < groups; g++) {
        const start = d.readUInt32BE(off + 16 + g * 12), end = d.readUInt32BE(off + 20 + g * 12), first = d.readUInt32BE(off + 24 + g * 12)
        if (codePoint >= start && codePoint <= end) return first + codePoint - start
      }
    }
  }
  throw new Error(`no glyph for U+${codePoint.toString(16)}`)
}

/** The outline of one character: contours of { x, y, on } in font units (y up), and the font's units per em. */
export function glyphOutline(fontBuffer, character) {
  const tables = readTables(fontBuffer)
  const gid = glyphIdOf(tables.cmap, character.codePointAt(0))
  return { unitsPerEm: tables.head.data.readUInt16BE(18), contours: readGlyph(tables.glyf, gid) }
}

// ---- the outline as an SVG path (TrueType's quadratic curves, y flipped) ----
const num = (v) => String(Math.round(v * 100) / 100)

function contourPath(points, map) {
  const n = points.length
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true })
  let start, seq
  if (points[0].on) { start = points[0]; seq = points.slice(1) }
  else if (points[n - 1].on) { start = points[n - 1]; seq = points.slice(0, n - 1) }
  else { start = mid(points[0], points[n - 1]); seq = points }
  const P = (p) => { const [x, y] = map(p); return `${num(x)} ${num(y)}` }
  let d = `M${P(start)}`
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i]
    if (p.on) { d += `L${P(p)}`; continue }
    const next = seq[i + 1]
    if (next === undefined) d += `Q${P(p)} ${P(start)}`
    else if (next.on) { d += `Q${P(p)} ${P(next)}`; i++ }
    else d += `Q${P(p)} ${P(mid(p, next))}`
  }
  return `${d}Z`
}

/** The favicon as SVG text: the field, and the letter's outline sized and centred by its ink box. */
export function buildFaviconSvg({ font = fs.readFileSync(FONT_FILE), tokens = readTokens(), character = 'R' } = {}) {
  const { contours } = glyphOutline(font, character)
  const on = contours.flat().filter((p) => p.on)
  const [minX, maxX] = [Math.min(...on.map((p) => p.x)), Math.max(...on.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...on.map((p) => p.y)), Math.max(...on.map((p) => p.y))]
  const k = (LETTER_HEIGHT * SIZE) / (maxY - minY)
  const map = (p) => [SIZE / 2 + (p.x - (minX + maxX) / 2) * k, SIZE / 2 - (p.y - (minY + maxY) / 2) * k]
  const d = contours.map((c) => contourPath(c, map)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${tokens.teal}"/><path fill="${tokens.page}" d="${d}"/></svg>\n`
}

// ---- the avatar: the same SVG, rendered to a 512x512 PNG by headless Chrome, with no alpha channel ----
export function readPng(file) {
  const d = fs.readFileSync(file)
  let pos = 8, w, h, ct
  const idat = []
  while (pos < d.length) {
    const len = d.readUInt32BE(pos), type = d.toString('ascii', pos + 4, pos + 8), data = d.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * bpp, px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y > 0 ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
      let r
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1)
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) }
      px[y * stride + x] = r & 255
    }
  }
  return { w, h, bpp, px }
}
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]) }

/** Re-writes an RGBA PNG as RGB, after checking every pixel is fully opaque. */
export function stripAlpha(file) {
  const { w, h, bpp, px } = readPng(file)
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    if (bpp === 4 && px[i * 4 + 3] !== 255) throw new Error('the render is not fully opaque')
    for (let j = 0; j < 3; j++) rgb[i * 3 + j] = px[i * bpp + j]
  }
  const rows = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]))
}

export async function renderPng(svgFile, pngFile, px = SIZE) {
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p))
  if (!chrome) throw new Error('no Chrome found (set CHROME_PATH)')
  const puppeteer = createRequire(path.join(ROOT, 'package.json'))('puppeteer-core')
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 })
    const html = path.join(path.dirname(svgFile), '.render.html')
    fs.writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#ff00ff}img{display:block;width:${px}px;height:${px}px}</style><img src="${path.basename(svgFile)}">`)
    await page.goto(`file://${html}`)
    await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0)
    await page.screenshot({ path: pngFile, clip: { x: 0, y: 0, width: px, height: px } })
    fs.unlinkSync(html)
  } finally {
    await browser.close()
  }
  stripAlpha(pngFile)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svg = buildFaviconSvg()
  const target = path.join(ROOT, 'public', 'favicon.svg')
  fs.writeFileSync(target, svg)
  console.log(`${path.relative(ROOT, target)}: ${Buffer.byteLength(svg)} bytes`)
  const i = process.argv.indexOf('--avatar')
  if (i !== -1) {
    const png = path.resolve(process.argv[i + 1])
    await renderPng(target, png)
    console.log(`${png}: ${SIZE}x${SIZE}`)
  }
}
