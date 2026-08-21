/**
 * Shared helpers for the dev-*-smoke.mjs suites (dsh-ios carried one copy of
 * these per script; dsh-android shares them from day one).
 *
 * Every smoke is a plain Node ESM script with no test framework: run
 * `pnpm run build` first — suites import the COMPILED lib/*.js, never src.
 */

import { createHmac } from 'node:crypto'
import http from 'node:http'

/** Three-state step reporter: verdict is true/false or the string 'SKIP'. */
export function createStepReporter() {
  const results = []
  let failed = 0
  function step(name, verdict, detail = '') {
    const normalized = verdict === true ? 'PASS' : verdict === false ? 'FAIL' : verdict
    if (normalized === 'FAIL') failed += 1
    results.push({ name, verdict: normalized, detail })
    console.log(`${normalized.padEnd(4)} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
  function finish() {
    const passed = results.filter(entry => entry.verdict === 'PASS').length
    console.log(`\n${passed}/${results.length} steps passed${failed > 0 ? ` (${failed} FAILED)` : ''}`)
    process.exitCode = failed > 0 ? 1 : 0
  }
  return { step, finish, results }
}

/** Assert `invoke` throws with a message matching `pattern`. */
export async function expectThrow(step, label, invoke, pattern, alsoForbidden) {
  try {
    await invoke()
    step(label, false, 'no error was thrown')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const ok = pattern.test(message) && (alsoForbidden === undefined || !alsoForbidden.test(message))
    step(label, ok, ok ? message.slice(0, 160) : `unexpected error: ${message.slice(0, 200)}`)
  }
}

/** Scoped env patching that always restores, even on failure. */
export function withEnv(patch, task) {
  const prior = {}
  for (const [key, value] of Object.entries(patch)) {
    prior[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return Promise.resolve().then(task).finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

/** Minimal ToolRunContext for calling ToolDefinition.execute directly. */
export function makeExec(toolName, args) {
  return {
    callId: `smoke-${toolName}`,
    rootCallId: `smoke-${toolName}`,
    name: toolName,
    arguments: args,
    signal: new AbortController().signal,
  }
}

/**
 * Minimal webserver facsimile with the same (kind, path) registries and
 * dispatch semantics as the DSH webServer service, so mountStreamRoutes can
 * be exercised on a plain node:http server without a cordis Context.
 */
export function createMiniWebServer() {
  const exact = new Map()
  const prefixes = new Map()
  const server = http.createServer((req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    let route = exact.get(pathname)
    if (route === undefined) {
      for (const [prefix, candidate] of prefixes) {
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
          route = candidate
          break
        }
      }
    }
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    Promise.resolve(route.handler(req, res)).catch(error => {
      console.error('route handler failed:', error)
      if (res.headersSent) res.destroy()
      else {
        res.writeHead(500)
        res.end()
      }
    })
  })
  return {
    server,
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`duplicate route ${route.path}`)
      table.set(route.path, route)
      return () => table.delete(route.path)
    },
  }
}

/** Sign a capability the way the server does (for negative-path tests). */
export function signToken(key, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', key).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/**
 * Execute the built browser bundle (lib/client.js) in Node and return its
 * exports. `requireModule` resolves the never-bundled specifiers (react,
 * react-dom, …) — pass a createRequire anchored next to react-dom/server so
 * one React instance serves both the bundle and the SSR renderer.
 */
export function loadClientExports(source, pluginId, requireModule) {
  const loaded = {}
  const browserWindow = {
    __ModuleLoader__: {
      load({ id, factory }) {
        loaded[id] = factory(specifier => requireModule(specifier))
      },
    },
  }
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('window', source)
  evaluate(browserWindow)
  const client = loaded[pluginId]
  if (client === undefined) throw new Error(`client bundle did not register ${pluginId}`)
  return client
}

/** Walk a tool result and report lossless-JSON violations (undefined value
 * keys, -0, non-finite numbers) — the same boundary DSH enforces. */
export function findJsonViolations(value, path = '$', violations = []) {
  if (value === undefined) violations.push(`${path} is undefined`)
  else if (typeof value === 'number') {
    if (!Number.isFinite(value)) violations.push(`${path} is non-finite`)
    else if (Object.is(value, -0)) violations.push(`${path} is -0`)
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => findJsonViolations(entry, `${path}[${index}]`, violations))
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) findJsonViolations(entry, `${path}.${key}`, violations)
  }
  return violations
}

/** A 1×1 transparent PNG for fake screencap output. */
export const TINY_PNG_B64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
