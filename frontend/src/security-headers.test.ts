import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The same security headers ship two ways: nginx (Docker) and public/_headers
// (static hosts). They must not drift apart.

const root = resolve(__dirname, '..')

function nginxHeaders(): Record<string, string> {
  const conf = readFileSync(resolve(root, 'nginx.conf.template'), 'utf-8')
  return Object.fromEntries(
    [...conf.matchAll(/add_header\s+([\w-]+)\s+"([^"]+)"\s+always;/g)].map((m) => [m[1], m[2]]),
  )
}

function staticHeaders(): Record<string, string> {
  const file = readFileSync(resolve(root, 'public/_headers'), 'utf-8')
  return Object.fromEntries(
    file
      .split('\n')
      .filter((l) => /^\s+[\w-]+:/.test(l))
      .map((l) => {
        const [name, ...rest] = l.trim().split(':')
        return [name, rest.join(':').trim()]
      }),
  )
}

describe('security headers', () => {
  it('nginx and static-host headers are identical', () => {
    expect(staticHeaders()).toEqual(nginxHeaders())
  })

  it('the CSP blocks inline and third-party scripts and allows only known LLM hosts', () => {
    const csp = nginxHeaders()['Content-Security-Policy']
    const directives = Object.fromEntries(
      csp.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/)
        return [name, values]
      }),
    )
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['connect-src']).toEqual([
      "'self'",
      'https://generativelanguage.googleapis.com',
    ])
    expect(directives['frame-ancestors']).toEqual(["'none'"])
    expect(directives['object-src']).toEqual(["'none'"])
  })
})
