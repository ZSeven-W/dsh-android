import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execOcr, filterOcrItems, parseOcrOutput, parseTesseractTsv, resolveOcrBinary } from '../lib/ocr-backend.js'
import { withEnv } from './_smoke-harness.mjs'

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
const row = (text, word, x, conf = 95, block = 1, line = 1) => [5, 1, block, 1, line, word, x, 20, 30, 40, conf, text].join('\t')
const tsv = (...rows) => header + '\n' + rows.join('\n') + '\n'

test('Chinese character words become a matching label with a unioned pixel box', () => {
  const items = parseTesseractTsv(tsv(row('设', 1, 10, 96), row('置', 2, 43, 94)))
  assert.equal(items[0].text, '设置')
  assert.deepEqual(items[0].rect, { x: 10, y: 20, w: 63, h: 40 })
  assert.ok(Math.abs(items[0].confidence - 0.95) < 1e-9)
  assert.equal(filterOcrItems(items, '设置', 0.9).length, 1)
})

test('Latin words retain separators and word order', () => {
  const items = parseTesseractTsv(tsv(row('ACCESS', 2, 50), row('ALLOW', 1, 10)))
  assert.equal(items[0].text, 'ALLOW ACCESS')
  assert.equal(filterOcrItems(items, 'ALLOW ACCESS').length, 1)
  assert.equal(filterOcrItems(items, 'ALLOWACCESS').length, 0)
})

test('block and line identities keep unrelated labels apart', () => {
  const items = parseTesseractTsv(tsv(row('设置', 1, 10), row('蓝牙', 1, 80, 95, 2), row('WLAN', 1, 150, 95, 1, 2)))
  assert.deepEqual(items.map(i => i.text), ['设置', '蓝牙', 'WLAN'])
})

test('empty line rows, duplicate words and malformed numeric rows do not become observations', () => {
  const valid = row('设置', 1, 10)
  const items = parseTesseractTsv(tsv(valid, valid, '4\t1\t1\t1\t1\t0\t0\t0\t50\t50\t-1\t',
    row('bad', 2, 20, -1), row('bad', 3, -1), row('bad', 4, 30).replace('\t30\t20\t', '\t\t20\t')))
  assert.deepEqual(items.map(i => i.text), ['设置'])
})

test('a UTF-8 BOM is accepted but an unexpected output format is an error', () => {
  assert.equal(parseTesseractTsv('\uFEFF' + tsv(row('WLAN', 1, 10))).length, 1)
  assert.throws(() => parseTesseractTsv('{}'), /TSV header/)
})

test('an invalid backend or language identifier fails explicitly', async () => {
  await withEnv({ DSHPLUGIN_ANDROID_OCR_BACKEND: 'other' }, async () => {
    assert.equal(resolveOcrBinary().available, false)
    assert.match(resolveOcrBinary().reason, /auto, vision or tesseract/)
  })
  await withEnv({ DSHPLUGIN_ANDROID_OCR_BACKEND: 'tesseract', DSHPLUGIN_ANDROID_TESSERACT_LANGUAGES: 'eng --psm 0' }, async () => {
    assert.equal(resolveOcrBinary().available, false)
    assert.match(resolveOcrBinary().reason, /language identifiers/)
  })
})

test('a missing explicit Tesseract path is not replaced by a PATH installation', async () => {
  await withEnv({ DSHPLUGIN_ANDROID_OCR_BACKEND: 'tesseract', DSHPLUGIN_ANDROID_TESSERACT_BINARY: '/missing/tesseract' }, async () => {
    assert.equal(resolveOcrBinary().available, false)
    assert.match(resolveOcrBinary().reason, /\/missing\/tesseract/)
  })
})

test('Windows resolution finds tesseract.exe without POSIX executable bits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tess-resolve-'))
  try {
    writeFileSync(join(dir, 'tesseract.exe'), 'fixture', { mode: 0o600 })
    await withEnv({ PATH: dir, DSHPLUGIN_ANDROID_OCR_BACKEND: 'auto', DSHPLUGIN_ANDROID_TESSERACT_BINARY: '', DSHPLUGIN_ANDROID_TESSERACT_LANGUAGES: '' }, async () => {
      const resolved = resolveOcrBinary({ platform: 'win32' })
      assert.equal(resolved.backend, 'tesseract')
      assert.equal(resolved.available, true)
      assert.equal(resolved.command, join(dir, 'tesseract.exe'))
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a missing requested language cannot silently pass with English-only output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tess-warning-'))
  try {
    const program = join(dir, 'image-stand-in.mjs')
    writeFileSync(program, 'process.stdout.write(' + JSON.stringify(tsv(row('HELLO', 1, 10)))
      + ');process.stderr.write("Failed loading language chi_sim\\n")')
    await assert.rejects(execOcr({ available: true, source: 'path', command: process.execPath, backend: 'tesseract', installHint: 'install language data' }, program), /language data is unavailable/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Tesseract execution produces the existing sanitized JSON observation contract', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tess-output-'))
  try {
    const program = join(dir, 'image-stand-in.mjs')
    writeFileSync(program, 'process.stdout.write(' + JSON.stringify(tsv(row('设', 1, 10), row('置', 2, 43))) + ')')
    const output = await execOcr({ available: true, source: 'path', command: process.execPath, backend: 'tesseract', installHint: '' }, program)
    assert.equal(parseOcrOutput(output.stdout)[0].text, '设置')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
