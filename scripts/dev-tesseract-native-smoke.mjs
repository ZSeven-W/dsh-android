import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureOcrBinary, execOcr, filterOcrItems, parseOcrOutput } from '../lib/ocr-backend.js'
import { createAndroidOcrTools } from '../lib/tool-ocr.js'
import { makeExec } from './_smoke-harness.mjs'

process.env.DSHPLUGIN_ANDROID_OCR_BACKEND = 'tesseract'
const binary = await ensureOcrBinary()
assert.equal(binary.available, true, binary.reason)
const image = fileURLToPath(new URL('./fixtures/ocr-screen.png', import.meta.url))
const output = await execOcr(binary, image)
const items = parseOcrOutput(output.stdout)
for (const query of ['HELLO ANDROID', '设置', 'ALLOW ACCESS']) {
  const matches = filterOcrItems(items, query, 0.3)
  assert.equal(matches.length, 1, JSON.stringify({ query, items }))
  const { rect } = matches[0]
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0)
  assert.ok(rect.x + rect.w <= 900 && rect.y + rect.h <= 440)
}
const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-native-ocr-tool-'))
let tapped
try {
  const host = {
    toolchain: {},
    async resolveTarget() { return { serial: 'emulator-5554', state: 'device', emulator: true } },
    async screenshot() { return { png: readFileSync(image), width: 900, height: 440 } },
    async tap() { throw new Error('Do not rescale screenshot pixels through a stale or unrotated frame') },
    async tapPixels(serial, x, y) { tapped = { serial, x, y } },
    async inputSpace() { return { width: 440, height: 900 } },
  }
  const tools = createAndroidOcrTools(host, { cacheDir })
  const result = await tools.androidTapText.execute({ query: '设置' }, makeExec('android_tap_text', {}))
  assert.deepEqual(tapped, { serial: 'emulator-5554', x: result.center.x, y: result.center.y })
  assert.ok(result.center.y > 100)
} finally { rmSync(cacheDir, { recursive: true, force: true }) }
console.log(JSON.stringify({ backend: binary.backend, languages: binary.languages, command: binary.command, items, nativeRecognitionPassed: true, pixelToolPassed: true, tapped }))
