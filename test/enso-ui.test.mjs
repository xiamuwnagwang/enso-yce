import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import React from 'react'
import {
  STATUS_CLEAR_MS,
  STYLE,
  canRestore,
  enhanceDraft,
  messageFor,
  nextRestore,
  onLoad,
  pickLocale,
} from '../ui.js'

const uiSource = readFileSync(new URL('../ui.js', import.meta.url), 'utf8')

function composer(snap, replace = async () => ({ rev: 'r2' })) {
  return {
    readDraft: async () => snap,
    replaceDraft: replace,
  }
}

describe('Blob URL renderer safety and styling', () => {
  it('contains zero import statements so Enso can load ui.js from a Blob URL', () => {
    assert.doesNotMatch(uiSource, /^\s*import\s/m)
    assert.doesNotMatch(uiSource, /\bimport\s*\(/)
    assert.doesNotMatch(uiSource, /^\s*export\s+\{[^}]*\}\s+from\b/m)
  })

  it('uses 25px composer button geometry, YCE icon paths, and reduced-motion fallbacks', () => {
    assert.match(STYLE, /\.yceenso-btn\s*\{[^}]*width:\s*25px/)
    assert.match(STYLE, /\.yceenso-icon\s*\{[^}]*width:\s*12\.5px/)
    assert.match(STYLE, /prefers-reduced-motion:\s*reduce/)
    assert.deepEqual(STATUS_CLEAR_MS, { ok: 3500, error: 5000 })
  })
})

describe('pickLocale and messageFor', () => {
  it('resolves host locale before document and navigator fallbacks', () => {
    assert.equal(pickLocale({ locale: 'zh-CN' }, { documentLang: 'en', languages: ['en-US'] }), 'zh')
    assert.equal(pickLocale({ language: () => 'en-US' }, { documentLang: 'zh-CN' }), 'en')
    assert.equal(pickLocale({}, { documentLang: 'zh-Hans', languages: ['en-US'] }), 'zh')
    assert.equal(pickLocale({}, { documentLang: '', languages: ['fr-FR', 'zh-TW'] }), 'en')
  })

  it('maps YCE-specific error codes in both Chinese and English', () => {
    assert.match(messageFor('mcp_missing', 'zh'), /yce-mcp/)
    assert.match(messageFor('mcp_missing', 'zh'), /Settings → MCP/)
    assert.match(messageFor('mcp_missing', 'zh'), /yce\.aigy\.de\/console/)
    assert.match(messageFor('cli_missing', 'zh'), /YCE_MCP_SKILL_ROOT/)
    assert.match(messageFor('auth_error', 'zh'), /YCE_RELAY_TOKEN/)
    assert.match(messageFor('quota_exceeded', 'zh'), /额度/)
    assert.match(messageFor('timeout', 'en'), /120s/)
  })
})

describe('enhanceDraft and restore state', () => {
  it('attaches copyable mcpConfigText when yce-mcp is not configured', async () => {
    const enso = {
      composer: composer({ text: 'optimize sql query', generation: 'g1', rev: 'r1' }),
      dispatch: async () => ({ ok: false, code: 'mcp_missing', message: 'not found' }),
    }
    const res = await enhanceDraft(enso, 's1', 'optimize sql query', 'zh')
    assert.equal(res.ok, false)
    assert.equal(res.code, 'mcp_missing')
    assert.equal(typeof res.mcpConfigText, 'string')
    const parsed = JSON.parse(res.mcpConfigText)
    assert.equal(parsed.mcpServers.yce.command, 'npx')
    assert.deepEqual(parsed.mcpServers.yce.args, ['--yes', 'yce-mcp@latest'])
    assert.match(parsed.mcpServers.yce.env.YCE_RELAY_TOKEN, /yce\.aigy\.de\/console/)
  })

  it('replaces draft with expected generation and rev when live draft is unchanged', async () => {
    const replaced = []
    const enso = {
      composer: composer(
        { text: '  fix auth race  ', generation: 'g1', rev: 'r1', hasReferences: false },
        async (payload) => { replaced.push(payload) },
      ),
      dispatch: async (action, payload) => {
        assert.equal(action, 'plugin.call')
        assert.deepEqual(payload, { method: 'enhance', args: { prompt: 'fix auth race' } })
        return { ok: true, text: '1. Reproduce auth race\n2. Add mutex around token refresh' }
      },
    }

    const res = await enhanceDraft(enso, 's1', () => '  fix auth race  ', 'zh')
    assert.deepEqual(res, {
      ok: true,
      sessionId: 's1',
      original: 'fix auth race',
      enhanced: '1. Reproduce auth race\n2. Add mutex around token refresh',
    })
    assert.deepEqual(replaced, [
      {
        text: '1. Reproduce auth race\n2. Add mutex around token refresh',
        expect: { generation: 'g1', rev: 'r1' },
      },
    ])
  })

  it('refuses to overwrite when user edits draft during enhancement', async () => {
    let replaceCalled = false
    const enso = {
      composer: composer(
        { text: 'initial draft', generation: 'g1', rev: 'r1' },
        async () => { replaceCalled = true },
      ),
      dispatch: async () => ({ ok: true, text: 'enhanced draft' }),
    }

    const res = await enhanceDraft(enso, 's1', () => 'edited while waiting', 'en')
    assert.equal(res.ok, false)
    assert.equal(res.code, 'draft_changed')
    assert.equal(replaceCalled, false)
  })

  it('exposes copyText fallback when draft has file references or exceeds Enso 32KB limit', async () => {
    const withRefs = {
      composer: composer(
        { text: 'check @app.ts', generation: 'g1', rev: 'r1' },
        async () => {
          throw Object.assign(new Error('references present'), { code: 'DRAFT_HAS_REFERENCES' })
        },
      ),
      dispatch: async () => ({ ok: true, text: 'Enhanced text for @app.ts' }),
    }
    const refRes = await enhanceDraft(withRefs, 's1', 'check @app.ts', 'zh')
    assert.equal(refRes.ok, false)
    assert.equal(refRes.code, 'DRAFT_HAS_REFERENCES')
    assert.equal(refRes.copyText, 'Enhanced text for @app.ts')

    const tooBig = {
      composer: composer(
        { text: 'big plan', generation: 'g1', rev: 'r1' },
        async () => {
          throw Object.assign(new Error('草稿过大（>32KB）'), { code: 'INVALID_ARGS' })
        },
      ),
      dispatch: async () => ({ ok: true, text: 'x'.repeat(33_000) }),
    }
    const bigRes = await enhanceDraft(tooBig, 's1', 'big plan', 'en')
    assert.equal(bigRes.ok, false)
    assert.equal(bigRes.code, 'TOO_LARGE')
    assert.equal(bigRes.copyText.length, 33_000)
  })

  it('keeps initial original prompt across chained enhancements in the same session', () => {
    const first = nextRestore(undefined, 's1', 'raw draft', 'enhanced v1')
    assert.deepEqual(first, { sessionId: 's1', original: 'raw draft', enhanced: 'enhanced v1' })

    const second = nextRestore(first, 's1', 'enhanced v1', 'enhanced v2')
    assert.deepEqual(second, { sessionId: 's1', original: 'raw draft', enhanced: 'enhanced v2' })

    const otherSession = nextRestore(second, 's2', 'enhanced v2', 'enhanced v3')
    assert.deepEqual(otherSession, { sessionId: 's2', original: 'enhanced v2', enhanced: 'enhanced v3' })

    assert.equal(canRestore(second, 's1', 'enhanced v2', false), true)
    assert.equal(canRestore(second, 's1', 'raw draft', false), false)
    assert.equal(canRestore(second, 's1', 'enhanced v2', true), false)
    assert.equal(canRestore(second, 's2', 'enhanced v2', false), false)
  })
})

describe('onLoad lifecycle', () => {
  it('registers EnhanceButton on composer.left and removes style tag on dispose', async () => {
    const removed = []
    const style = { dataset: {}, textContent: '', remove() { removed.push(true) } }
    const previousDocument = globalThis.document
    globalThis.document = {
      createElement() { return style },
      head: { appendChild() {} },
      documentElement: { lang: 'zh-CN' },
    }
    try {
      const registered = []
      const dispose = await onLoad({
        React,
        slots: {
          register(entry) {
            registered.push(entry)
            return () => {}
          },
        },
      })
      assert.equal(registered.length, 1)
      assert.equal(registered[0].slot, 'composer.left')
      assert.equal(typeof registered[0].component, 'function')
      assert.equal(style.dataset.plugin, 'yce.enhance')
      assert.match(style.textContent, /yceenso-btn/)
      dispose()
      assert.deepEqual(removed, [true])
    } finally {
      globalThis.document = previousDocument
    }
  })
})
