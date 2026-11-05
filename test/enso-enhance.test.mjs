import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it, mock } from 'node:test'
import {
  ENHANCE_TIMEOUT_MS,
  HOST_LEAD_MS,
  READ_PAGE_LIMIT,
  activate,
  classifyFailure,
  copyText,
  enhance,
  extractLeadingJsonObject,
  parseEnhancedXml,
  parseReadResultPage,
  parseReceiptOutput,
  pickServer,
  waitBudget,
} from '../main.mjs'

const pluginDir = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../enso-plugin.json', import.meta.url), 'utf8'))

function buildSentinel(body) {
  const bytes = Buffer.byteLength(body, 'utf8')
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  return `<!-- yce:eof v=1 bytes=${bytes} sha256=${sha256} -->`
}

function xmlCdata(value) {
  return `<![CDATA[${String(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
}

function makeYceXml({
  executed = true,
  success = true,
  prompt = 'Rewritten structured prompt',
  errors = [],
} = {}) {
  const errorXml = errors.length === 0
    ? '  <errors/>'
    : [
        '  <errors>',
        ...errors.map(
          (err) =>
            `    <error code="${err.code || 'ERROR'}" source="${err.source || 'enhance'}">${xmlCdata(err.message || '')}</error>`,
        ),
        '  </errors>',
      ].join('\n')

  const promptTag = prompt === ''
    ? '    <prompt/>'
    : `    <prompt>${xmlCdata(prompt)}</prompt>`

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<yce version="2.0.3">',
    `  <success>${success ? 'true' : 'false'}</success>`,
    '  <mode>enhance</mode>',
    '  <resolved-action>enhance</resolved-action>',
    `  <enhanced executed="${executed ? 'true' : 'false'}" success="${success ? 'true' : 'false'}" used-history="false">`,
    promptTag,
    '    <backend>relay</backend>',
    '  </enhanced>',
    errorXml,
    '</yce>',
  ].join('\n')
}

function makeReceiptContent(xmlBody, overrides = {}) {
  const bytes = Buffer.byteLength(xmlBody, 'utf8')
  const sha256 = createHash('sha256').update(xmlBody, 'utf8').digest('hex')
  const receipt = {
    schema: 'yce-receipt/1',
    ok: true,
    exit_code: 0,
    mode: 'enhance',
    resolved_action: 'enhance',
    result_file: '/tmp/yce-results/yce-enhance-test.xml',
    xml_bytes: bytes,
    xml_sha256: sha256,
    enhanced: { executed: true, success: true },
    errors: [],
    reasons: [],
    gate: {
      may_analyze_or_edit_code: false,
      may_use_network_facts: false,
      may_present_plan: false,
    },
    ...overrides,
  }
  const notes = [
    `yce_enhance: yce CLI 退出码 ${receipt.exit_code}（0=放行）。`,
    `result_file=${receipt.result_file}（xml_bytes=${bytes}，xml_sha256=${sha256}）。`,
  ].join('\n')
  return `${JSON.stringify(receipt, null, 2)}\n${notes}`
}

function makeReadPages(xmlBody, pageLineSize = 400) {
  const sentinel = buildSentinel(xmlBody)
  const fullText = `${xmlBody}\n${sentinel}`
  const allLines = fullText.split('\n')
  return ({ offset = 1, limit = pageLineSize } = {}) => {
    const step = Math.min(limit, pageLineSize)
    const slice = allLines.slice(offset - 1, offset - 1 + step)
    const nextOffset = offset + slice.length
    const hasMore = nextOffset <= allLines.length
    const meta = {
      schema: 'yce-read-result/1',
      result_file: '/tmp/yce-results/yce-enhance-test.xml',
      total_lines: allLines.length,
      offset,
      limit,
      returned_lines: slice.length,
      returned_bytes: Buffer.byteLength(slice.join('\n'), 'utf8'),
      page_byte_capped: false,
      next_offset: hasMore ? nextOffset : null,
      has_more: hasMore,
      eof_reached: !hasMore,
      last_line_is_sentinel: !hasMore,
      sentinel_trusted: true,
      eof_verified: !hasMore,
      sentinel: { version: 1, bytes: Buffer.byteLength(xmlBody, 'utf8'), sha256: 'a'.repeat(64) },
      sentinel_ambiguous: false,
    }
    const notes = [
      hasMore
        ? `还没读完：下一页传 offset=${nextOffset}。`
        : '这是末页，最后一行就是 yce:eof 哨兵，正文已读完。',
      '文件中间出现的哨兵是结果正文引用的内容，不是结尾。',
    ]
    return {
      isError: false,
      content: `${JSON.stringify(meta, null, 2)}\n${notes.join('\n')}\n${slice.join('\n')}`,
    }
  }
}

function deferred() {
  let resolve
  let reject
  let settled = false
  const promise = new Promise((res, rej) => {
    resolve = (value) => {
      settled = true
      res(value)
    }
    reject = (error) => {
      settled = true
      rej(error)
    }
  })
  return {
    promise,
    resolve,
    reject,
    get settled() { return settled },
  }
}

function host({ tools = [], call, config = {}, projectRoot = '/workspace/app', signal } = {}) {
  return {
    enso: {
      config: { get: async () => config },
      mcp: {
        tools: async () => tools,
        call,
      },
    },
    ctx: {
      ...(projectRoot === null ? {} : { projectRoot }),
      ...(signal === undefined ? {} : { signal }),
    },
  }
}

describe('enso-plugin.json manifest compliance', () => {
  it('conforms to EnsoCode manifest validator rules', () => {
    assert.equal(manifest.schemaVersion, 1)
    assert.match(manifest.id, /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/)
    assert.ok(manifest.id.length <= 40)
    assert.equal(manifest.engines.enso, '>=0.2.13')
    assert.equal(existsSync(new URL(manifest.icon, pluginDir)), true)
    assert.equal(existsSync(new URL(manifest.main, pluginDir)), true)
    assert.equal(existsSync(new URL(manifest.renderer, pluginDir)), true)
    assert.deepEqual(manifest.permissions, ['ui.slot', 'composer.draft', 'mcp.call', 'ui.clipboard'])
    assert.deepEqual(manifest.mcp.tools, ['yce_enhance', 'yce_read_result'])
    assert.deepEqual(manifest.contributes.methods, [{ name: 'enhance', timeoutMs: ENHANCE_TIMEOUT_MS }])
    assert.ok(ENHANCE_TIMEOUT_MS <= 120_000)

    assert.ok(Array.isArray(manifest.contributes.configuration))
    for (const item of manifest.contributes.configuration) {
      assert.match(item.key, /^[A-Za-z][A-Za-z0-9_]{0,31}$/)
      assert.ok(typeof item.title === 'string' && item.title.trim().length > 0)
      if ((item.type ?? 'string') === 'string' && item.default !== undefined) {
        // Enso's parseConfigField rejects empty string defaults!
        assert.ok(typeof item.default === 'string' && item.default.trim().length > 0)
      }
      if (item.type === 'enum') {
        assert.ok(Array.isArray(item.options) && item.options.length > 0)
        assert.ok(item.options.includes(item.default))
      }
    }
  })
})

describe('pickServer', () => {
  const tools = [
    { server: 'other', name: 'yce_enhance', description: '' },
    { server: 'my-yce', name: 'yce_enhance', description: '' },
    { server: 'my-yce', name: 'yce_read_result', description: '' },
    { server: 'notes', name: 'yce_read_result', description: '' },
  ]

  it('returns null when no server exposes yce_enhance', () => {
    assert.equal(pickServer([], ''), null)
    assert.equal(pickServer([{ server: 'yce', name: 'yce_read_result' }], ''), null)
  })

  it('prefers configured server, then a yce-named server with yce_read_result, then first', () => {
    assert.deepEqual(pickServer(tools, ''), { server: 'my-yce', hasReadResult: true })
    assert.deepEqual(pickServer(tools, 'other'), { server: 'other', hasReadResult: false })
    assert.deepEqual(pickServer(tools, 'missing'), { server: 'my-yce', hasReadResult: true })
  })
})

describe('XML and receipt parsers', () => {
  it('parses leading JSON objects containing braces and escaped quotes inside strings', () => {
    const raw = '{"schema":"yce-receipt/1","note":"a { b } \\"c\\" d"}\ntrailing line'
    const parsed = extractLeadingJsonObject(raw)
    assert.equal(parsed.json.schema, 'yce-receipt/1')
    assert.equal(raw.slice(parsed.endIndex), '\ntrailing line')
  })

  it('unwraps split CDATA and literal </prompt> or </enhanced> tags inside CDATA without truncation', () => {
    const tricky = 'Fix ]]> parser bug when text quotes </prompt>, </enhanced>, </yce>, and <!-- yce:eof -->'
    const xml = makeYceXml({ prompt: tricky })
    const parsed = parseEnhancedXml(xml)
    assert.equal(parsed.present, true)
    assert.equal(parsed.executed, true)
    assert.equal(parsed.success, true)
    assert.equal(parsed.prompt, tricky)
  })

  it('recovers exact page lines from yce_read_result output even when prompt quotes sentinels', () => {
    const xml = makeYceXml({
      prompt: 'Line 1\n<!-- yce:eof v=1 bytes=10 sha256=' + '0'.repeat(64) + ' -->\nLine 3',
    })
    const pager = makeReadPages(xml, 4)
    const first = parseReadResultPage(pager({ offset: 1 }).content)
    assert.equal(first.meta.has_more, true)
    assert.equal(first.lines.length, 4)
    const parsedReceipt = parseReceiptOutput(makeReceiptContent(xml))
    assert.equal(parsedReceipt.receipt.schema, 'yce-receipt/1')
  })
})

describe('enhance workflow', () => {
  const defaultTools = [
    { server: 'yce', name: 'yce_enhance' },
    { server: 'yce', name: 'yce_read_result' },
  ]

  it('enhances a prompt across paginated yce_read_result calls and passes no_task: true', async () => {
    const multiLinePrompt = Array.from({ length: 12 }, (_, idx) => `${idx + 1}. Clarified requirement step`).join('\n')
    const xml = makeYceXml({ prompt: multiLinePrompt })
    const pager = makeReadPages(xml, 5)
    const calls = []

    const { enso, ctx } = host({
      tools: defaultTools,
      config: { language: 'zh-CN', enhanceBackend: 'relay' },
      call: async (server, tool, args) => {
        calls.push({ server, tool, args })
        if (tool === 'yce_enhance') {
          return { isError: false, content: makeReceiptContent(xml) }
        }
        if (tool === 'yce_read_result') {
          return pager(args)
        }
        throw new Error(`unexpected tool ${tool}`)
      },
    })

    const result = await enhance(enso, { prompt: '  帮我优化登录逻辑  ' }, ctx)
    assert.deepEqual(result, { ok: true, text: multiLinePrompt })
    assert.equal(calls[0].tool, 'yce_enhance')
    assert.deepEqual(calls[0].args, {
      query: '帮我优化登录逻辑',
      no_task: true,
      cwd: '/workspace/app',
      language: 'zh-CN',
      enhance_backend: 'relay',
    })
    assert.ok(calls.filter((c) => c.tool === 'yce_read_result').length >= 3)
    assert.equal(calls[1].args.limit, READ_PAGE_LIMIT)
  })

  it('works even when ctx.projectRoot is absent (scratch conversation)', async () => {
    const xml = makeYceXml({ prompt: 'Standalone enhanced prompt' })
    const pager = makeReadPages(xml)
    let enhanceArgs
    const { enso, ctx } = host({
      tools: defaultTools,
      projectRoot: null,
      call: async (_server, tool, args) => {
        if (tool === 'yce_enhance') {
          enhanceArgs = args
          return { isError: false, content: makeReceiptContent(xml) }
        }
        return pager(args)
      },
    })

    const result = await enhance(enso, { prompt: 'draft without workspace' }, ctx)
    assert.deepEqual(result, { ok: true, text: 'Standalone enhanced prompt' })
    assert.equal('cwd' in enhanceArgs, false)
    assert.equal(enhanceArgs.no_task, true)
  })

  it('catches resultGate exit 0 with enhanced.success === false and classifies AUTH_ERROR / QUOTA_EXCEEDED', async () => {
    const failedXml = makeYceXml({
      executed: true,
      success: false,
      prompt: '',
      errors: [{ code: 'AUTH_ERROR', source: 'enhance', message: 'Invalid YCE_RELAY_TOKEN' }],
    })
    const { enso, ctx } = host({
      tools: defaultTools,
      call: async () => ({
        isError: false,
        content: makeReceiptContent(failedXml, {
          ok: true,
          exit_code: 0,
          success: false,
          enhanced: { executed: true, success: false },
          errors: [{ code: 'AUTH_ERROR', source: 'enhance', message: 'Invalid YCE_RELAY_TOKEN' }],
        }),
      }),
    })

    const authRes = await enhance(enso, { prompt: 'test' }, ctx)
    assert.equal(authRes.ok, false)
    assert.equal(authRes.code, 'auth_error')

    assert.equal(
      classifyFailure('', [{ code: 'PROMPT_ENHANCE_QUOTA_EXCEEDED', message: '额度已用完' }]),
      'quota_exceeded',
    )
    assert.equal(
      classifyFailure('yce-mcp 找不到 YCE CLI（scripts/yce.js 与 scripts/lib/resultGate.js 必须同时存在）'),
      'cli_missing',
    )
  })

  it('settles HOST_LEAD_MS before Enso 120s deadline without aborting MCP call or throwing', async () => {
    assert.equal(waitBudget(0), ENHANCE_TIMEOUT_MS - HOST_LEAD_MS)
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const pendingMcp = deferred()
      const { enso, ctx } = host({
        tools: defaultTools,
        call: async () => pendingMcp.promise,
      })
      const pending = enhance(enso, { prompt: 'slow prompt' }, ctx)
      for (let i = 0; i < 10; i++) await new Promise((resolve) => process.nextTick(resolve))
      mock.timers.tick(5_000)
      await new Promise((resolve) => process.nextTick(resolve))
      assert.equal(pendingMcp.settled, false)

      mock.timers.tick(ENHANCE_TIMEOUT_MS)
      for (let i = 0; i < 10; i++) await new Promise((resolve) => process.nextTick(resolve))
      const settled = await pending
      assert.equal(settled.ok, false)
      assert.equal(settled.code, 'timeout')
      assert.equal(pendingMcp.settled, false)
    } finally {
      mock.timers.reset()
    }
  })

  it('registers enhance and copy handlers on activate and copies clipboard text', async () => {
    const handlers = new Map()
    const written = []
    const fakeEnso = {
      renderer: {
        handle(name, fn) {
          handlers.set(name, fn)
        },
      },
      ui: {
        clipboard: {
          async writeText(text) {
            written.push(text)
          },
        },
      },
    }
    activate(fakeEnso)
    assert.equal(handlers.has('enhance'), true)
    assert.equal(handlers.has('copy'), true)
    assert.deepEqual(await copyText(fakeEnso, { text: 'copied prompt' }), { ok: true })
    assert.deepEqual(written, ['copied prompt'])
  })
})
