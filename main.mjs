// YCE credentials (YCE_RELAY_TOKEN / YCE_MCP_SKILL_ROOT) stay solely in the
// user's EnsoCode MCP entry. This plugin never stores or reads secrets; it only
// calls the host-managed `yce_enhance` and `yce_read_result` MCP tools.
//
// Timeout & circuit-breaker design (matching dsh-bce on Enso >= 0.2.13):
// `enso.mcp.call(server, tool, args)` does not accept an AbortSignal, and Enso
// caps renderer methods + plugin MCP calls at 120s. We stop waiting HOST_LEAD_MS
// before the 120s host deadline and return `{ ok: false, code: 'timeout', ... }`
// instead of throwing, so the UI shows a friendly localized message without
// counting toward Enso's 5-failure / 30s UI RPC circuit breaker.

export const ENHANCE_TIMEOUT_MS = 120_000
/** Settle before Enso's matching 120s method/MCP cancel so friendly codes win. */
export const HOST_LEAD_MS = 1_500
export const READ_PAGE_LIMIT = 400
export const MAX_READ_PAGES = 64

const ENHANCE_TIMEOUT_MESSAGE = `Enhancement timed out (${ENHANCE_TIMEOUT_MS / 1000}s). Check YCE_TIMEOUT_ENHANCE_MS or network connectivity in your yce-mcp configuration.`

/** Milliseconds left in the shared 120s budget, excluding the host lead. */
export function waitBudget(elapsedMs) {
  return Math.max(0, ENHANCE_TIMEOUT_MS - HOST_LEAD_MS - elapsedMs)
}

/**
 * Pick an MCP server exposing `yce_enhance` (and ideally `yce_read_result`):
 * configured server name -> name containing "yce" with read_result -> name
 * containing "yce" -> first server with read_result -> first server.
 */
export function pickServer(tools, preferred) {
  const enhanceServers = []
  const readServers = new Set()
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (tool === null || typeof tool !== 'object') continue
    const server = tool.server
    const name = tool.name
    if (typeof server !== 'string' || server.length === 0 || typeof name !== 'string') continue
    if (name === 'yce_enhance' && !enhanceServers.includes(server)) enhanceServers.push(server)
    if (name === 'yce_read_result') readServers.add(server)
  }
  if (enhanceServers.length === 0) return null

  const wanted = typeof preferred === 'string' ? preferred.trim() : ''
  const isYceNamed = (item) => item.toLowerCase().includes('yce')
  const server = (wanted && enhanceServers.find((item) => item === wanted))
    || enhanceServers.find((item) => isYceNamed(item) && readServers.has(item))
    || enhanceServers.find(isYceNamed)
    || enhanceServers.find((item) => readServers.has(item))
    || enhanceServers[0]

  return {
    server,
    hasReadResult: readServers.has(server),
  }
}

/**
 * Scan a leading JSON object (`{ ... }`) from `text` while respecting JSON
 * string literals and escapes, returning `{ json, endIndex }` or `null`.
 */
export function extractLeadingJsonObject(text) {
  if (typeof text !== 'string') return null
  let start = 0
  while (start < text.length && /\s/.test(text[start])) start += 1
  if (text[start] !== '{') return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const raw = text.slice(start, i + 1)
        try {
          return { json: JSON.parse(raw), endIndex: i + 1 }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * Parse `yce_enhance` MCP text output:
 * - Normal path: leading `yce-receipt/1` JSON object followed by human notes.
 * - Wrapped receipt: `<yce-receipt>{...}</yce-receipt>`.
 * - Disk-fallback path: raw `<yce>...</yce>` XML printed to stdout.
 */
export function parseReceiptOutput(content) {
  const raw = typeof content === 'string' ? content : ''
  const leading = extractLeadingJsonObject(raw)
  if (leading && leading.json && typeof leading.json === 'object') {
    const notes = raw.slice(leading.endIndex).trim()
    return { receipt: leading.json, notes, inlineXml: null }
  }
  const tagMatch = /<yce-receipt>\s*([\s\S]*?)\s*<\/yce-receipt>/.exec(raw)
  if (tagMatch) {
    try {
      return { receipt: JSON.parse(tagMatch[1]), notes: raw, inlineXml: null }
    } catch {
      return { receipt: null, notes: raw, inlineXml: null, invalidReceipt: true }
    }
  }
  if (raw.includes('<yce')) {
    return { receipt: null, notes: raw, inlineXml: raw }
  }
  return { receipt: null, notes: raw, inlineXml: null }
}

/**
 * Parse `yce_read_result` MCP text output.
 * Enso joins the two MCP text blocks (`metaJson + "\n" + notes` and `page`)
 * with `"\n"`. Because `page` was split on `"\n"` in `yce-mcp`, the trailing
 * `meta.returned_lines` lines after the leading `meta` JSON always recover
 * `page` verbatim regardless of note count or quoted sentinels.
 */
export function parseReadResultPage(content) {
  const raw = typeof content === 'string' ? content : ''
  const leading = extractLeadingJsonObject(raw)
  if (!leading || !leading.json || leading.json.schema !== 'yce-read-result/1') {
    return null
  }
  const meta = leading.json
  const count = Number.isInteger(meta.returned_lines) && meta.returned_lines >= 0
    ? meta.returned_lines
    : null
  if (count === null) return null
  if (count === 0) return { meta, lines: [] }

  let remainder = raw.slice(leading.endIndex)
  if (remainder.startsWith('\r\n')) remainder = remainder.slice(2)
  else if (remainder.startsWith('\n')) remainder = remainder.slice(1)

  const allLines = remainder.split('\n')
  if (allLines.length < count) return null
  return {
    meta,
    lines: allLines.slice(allLines.length - count),
  }
}

function decodeXmlEntities(text) {
  return String(text).replace(
    /&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g,
    (full, entity) => {
      switch (entity) {
        case 'lt': return '<'
        case 'gt': return '>'
        case 'amp': return '&'
        case 'quot': return '"'
        case 'apos': return "'"
        default: {
          const code = entity.startsWith('#x')
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10)
          return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full
        }
      }
    },
  )
}

function parseAttributes(attrText) {
  const attrs = {}
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match
  while ((match = re.exec(attrText)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '')
  }
  return attrs
}

/**
 * Find the next opening or self-closing `<tagName ...>` outside CDATA and XML
 * comments starting from `fromIndex`.
 */
function findTagOutsideCdata(xml, tagName, fromIndex = 0) {
  let i = fromIndex
  const needle = `<${tagName}`
  while (i < xml.length) {
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9)
      if (end < 0) return null
      i = end + 3
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end < 0) return null
      i = end + 3
      continue
    }
    if (xml.startsWith(needle, i)) {
      const boundary = xml[i + needle.length]
      if (boundary === undefined || /[\s>/]/.test(boundary)) {
        let j = i + needle.length
        let quote = ''
        while (j < xml.length) {
          const ch = xml[j]
          if (quote) {
            if (ch === quote) quote = ''
          } else if (ch === '"' || ch === "'") {
            quote = ch
          } else if (ch === '>') {
            const rawInside = xml.slice(i + needle.length, j)
            const selfClosing = rawInside.trimEnd().endsWith('/')
            const attrSource = selfClosing
              ? rawInside.replace(/\/\s*$/, '')
              : rawInside
            return {
              start: i,
              end: j + 1,
              selfClosing,
              attrs: parseAttributes(attrSource),
            }
          }
          j += 1
        }
        return null
      }
    }
    i += 1
  }
  return null
}

/**
 * Read the text content of `<tagName ...>...</tagName>` starting at `tag.end`,
 * handling arbitrary CDATA blocks (including split `]]]]><![CDATA[>` and literal
 * closing tags inside CDATA) plus XML entity escapes.
 */
function readTextElementContent(xml, tag, tagName) {
  if (tag.selfClosing) return { text: '', end: tag.end }
  const closeNeedle = `</${tagName}`
  let i = tag.end
  let out = ''
  while (i < xml.length) {
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9)
      if (end < 0) return null
      out += xml.slice(i + 9, end)
      i = end + 3
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end < 0) return null
      i = end + 3
      continue
    }
    if (xml.startsWith(closeNeedle, i)) {
      const after = xml[i + closeNeedle.length]
      if (after === '>' || /\s/.test(after ?? '')) {
        const closeEnd = xml.indexOf('>', i + closeNeedle.length)
        if (closeEnd < 0) return null
        return { text: out, end: closeEnd + 1 }
      }
    }
    const nextSpecial = xml.indexOf('<', i + 1)
    const sliceEnd = nextSpecial < 0 ? xml.length : nextSpecial
    out += decodeXmlEntities(xml.slice(i, sliceEnd))
    i = sliceEnd
  }
  return null
}

function findClosingTagOutsideCdata(xml, tagName, fromIndex) {
  const closeNeedle = `</${tagName}`
  let i = fromIndex
  while (i < xml.length) {
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9)
      if (end < 0) return -1
      i = end + 3
      continue
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end < 0) return -1
      i = end + 3
      continue
    }
    if (xml.startsWith(closeNeedle, i)) {
      const after = xml[i + closeNeedle.length]
      if (after === '>' || /\s/.test(after ?? '')) {
        const closeEnd = xml.indexOf('>', i + closeNeedle.length)
        return closeEnd < 0 ? -1 : closeEnd + 1
      }
    }
    i += 1
  }
  return -1
}

/**
 * Parse `<enhanced>` and top-level `<errors>` from a YCE XML document.
 */
export function parseEnhancedXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('<yce')) return null
  const yceRoot = findTagOutsideCdata(xml, 'yce', 0)
  if (!yceRoot) return null
  const yceClose = yceRoot.selfClosing ? yceRoot.end : findClosingTagOutsideCdata(xml, 'yce', yceRoot.end)
  if (yceClose < 0) return null

  const errors = []
  const errorsTag = findTagOutsideCdata(xml, 'errors', yceRoot.end)
  if (errorsTag && !errorsTag.selfClosing && errorsTag.start < yceClose) {
    const errorsEnd = findClosingTagOutsideCdata(xml, 'errors', errorsTag.end)
    let cursor = errorsTag.end
    const limit = errorsEnd > 0 ? errorsEnd : yceClose
    while (cursor < limit) {
      const errTag = findTagOutsideCdata(xml, 'error', cursor)
      if (!errTag || errTag.start >= limit) break
      const read = readTextElementContent(xml, errTag, 'error')
      if (!read) break
      errors.push({
        code: errTag.attrs.code || '',
        source: errTag.attrs.source || '',
        message: read.text.trim(),
      })
      cursor = read.end
    }
  }

  const enhancedTag = findTagOutsideCdata(xml, 'enhanced', yceRoot.end)
  if (!enhancedTag || enhancedTag.start >= yceClose) {
    return { present: false, executed: false, success: false, prompt: '', errors }
  }
  if (enhancedTag.selfClosing) {
    return {
      present: true,
      executed: enhancedTag.attrs.executed === 'true',
      success: enhancedTag.attrs.success === 'true',
      prompt: '',
      errors,
    }
  }
  const enhancedEnd = findClosingTagOutsideCdata(xml, 'enhanced', enhancedTag.end)
  if (enhancedEnd < 0) return null

  let prompt = ''
  const promptTag = findTagOutsideCdata(xml, 'prompt', enhancedTag.end)
  if (promptTag && promptTag.start < enhancedEnd) {
    const read = readTextElementContent(xml, promptTag, 'prompt')
    if (!read) return null
    prompt = read.text
  }

  return {
    present: true,
    executed: enhancedTag.attrs.executed === 'true',
    success: enhancedTag.attrs.success === 'true',
    prompt,
    errors,
  }
}

/**
 * Classify failed MCP/CLI outcomes into UI-friendly error codes.
 * Only called on failure paths so normal enhanced text mentioning these terms
 * never triggers false positives.
 */
export function classifyFailure(text, structuredErrors = []) {
  const codes = []
  const messages = [String(text || '')]
  for (const item of Array.isArray(structuredErrors) ? structuredErrors : []) {
    if (!item) continue
    if (typeof item === 'string') {
      messages.push(item)
    } else if (typeof item === 'object') {
      if (typeof item.code === 'string') codes.push(item.code.toUpperCase())
      if (typeof item.message === 'string') messages.push(item.message)
    }
  }

  for (const code of codes) {
    if (code === 'AUTH_ERROR' || code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN' || code === 'MISSING_TOKEN') {
      return 'auth_error'
    }
    if (code.includes('QUOTA') || code === 'RATE_LIMITED') {
      return 'quota_exceeded'
    }
    if (code === 'NOT_DEPLOYED') {
      return 'not_deployed'
    }
    if (code === 'DEPENDENCY_NOT_FOUND') {
      return 'cli_missing'
    }
    if (code === 'TIMEOUT' || code === 'ABORTED') {
      return 'timeout'
    }
  }

  const combined = messages.join('\n')
  const lower = combined.toLowerCase()

  if (
    combined.includes('找不到 YCE CLI')
    || lower.includes('yce_mcp_skill_root')
    || (lower.includes('scripts/yce.js') && lower.includes('resultgate.js'))
  ) {
    return 'cli_missing'
  }
  if (
    lower.includes('yce_relay_token')
    || lower.includes('invalid api key')
    || lower.includes('unauthorized')
    || /\bhttp\s*401\b/.test(lower)
    || combined.includes('未配置检索凭证')
    || combined.includes('凭证无效')
  ) {
    return 'auth_error'
  }
  if (
    lower.includes('quota')
    || combined.includes('额度')
    || combined.includes('次数已用')
    || /\bhttp\s*402\b/.test(lower)
  ) {
    return 'quota_exceeded'
  }
  if (lower.includes('not_deployed') || combined.includes('尚未部署')) {
    return 'not_deployed'
  }
  if (
    lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('tool call aborted')
    || combined.includes('超时杀掉')
    || combined.includes('请求超时')
  ) {
    return 'timeout'
  }
  return undefined
}

function fail(code, message) {
  return { ok: false, code, message }
}

function rawContentOf(result) {
  return result !== null && typeof result === 'object' && typeof result.content === 'string'
    ? result.content
    : ''
}

function isFailure(result, text) {
  return Boolean(result?.isError) || text.trimStart().startsWith('Error:')
}

export function isTimeoutError(error) {
  if (typeof error === 'object' && error !== null) {
    if (error.name === 'AbortError') return true
    if (error.code === 'TIMEOUT' || error.code === 'ABORTED' || error.code === 'timeout') return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /abort|timeout/i.test(message)
}

function watchAbort(signal) {
  if (signal === undefined || signal === null) return { promise: new Promise(() => {}), cancel() {} }
  let onAbort = () => {}
  const promise = new Promise((_, reject) => {
    onAbort = () => {
      reject(Object.assign(new Error('aborted'), { code: 'ABORTED', name: 'AbortError' }))
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    promise,
    cancel() {
      signal.removeEventListener('abort', onAbort)
    },
  }
}

function raceTimeout(work, ms, signal) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('timed out'), { code: 'TIMEOUT' }))
    }, ms)
  })
  const aborted = watchAbort(signal)
  return Promise.race([work, timeout, aborted.promise]).finally(() => {
    clearTimeout(timer)
    aborted.cancel()
  })
}

async function readPluginConfig(enso) {
  const raw = await enso.config.get()
  const cfg = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    server: typeof cfg.server === 'string' ? cfg.server : '',
    language: cfg.language === 'zh-CN' || cfg.language === 'en-US' ? cfg.language : '',
    enhanceBackend: cfg.enhanceBackend === 'relay' || cfg.enhanceBackend === 'local'
      ? cfg.enhanceBackend
      : '',
  }
}

function failFromYce(notes, structuredErrors, fallbackMessage) {
  const firstErrorMsg = Array.isArray(structuredErrors)
    ? structuredErrors.map((e) => (typeof e === 'object' && e ? e.message : '')).find(Boolean)
    : ''
  const detail = firstErrorMsg || String(notes || '').trim() || fallbackMessage
  const classified = classifyFailure(notes, structuredErrors)
  if (classified === 'timeout') return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)
  if (classified !== undefined) return fail(classified, detail)
  return fail('upstream', detail)
}

export async function copyText(enso, args) {
  const text = typeof args?.text === 'string' ? args.text : ''
  if (text.trim().length === 0) return fail('empty_prompt', 'nothing to copy')
  try {
    await enso.ui.clipboard.writeText(text)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && typeof error.code === 'string'
      ? error.code
      : 'upstream'
    const message = error instanceof Error ? error.message : String(error)
    return fail(code, message)
  }
  return { ok: true }
}

export async function enhance(enso, args, ctx) {
  const started = Date.now()
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length === 0) return fail('empty_prompt', 'prompt is empty')

  let config
  try {
    config = await readPluginConfig(enso)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail('upstream', message)
  }

  let listed
  try {
    listed = await enso.mcp.tools()
  } catch (error) {
    if (isTimeoutError(error)) return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)
    const message = error instanceof Error ? error.message : String(error)
    return fail('upstream', message)
  }

  const picked = pickServer(listed, config.server)
  if (picked === null) {
    return fail(
      'mcp_missing',
      'YCE MCP tool yce_enhance was not found. Configure yce-mcp in this Enso profile.',
    )
  }

  const callArgs = {
    query: prompt,
    no_task: true,
    ...(typeof ctx?.projectRoot === 'string' && ctx.projectRoot.trim().length > 0
      ? { cwd: ctx.projectRoot }
      : {}),
    ...(config.language ? { language: config.language } : {}),
    ...(config.enhanceBackend ? { enhance_backend: config.enhanceBackend } : {}),
  }

  const enhanceBudget = waitBudget(Date.now() - started)
  if (enhanceBudget <= 0) return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)

  let enhancedCall
  try {
    enhancedCall = await raceTimeout(
      enso.mcp.call(picked.server, 'yce_enhance', callArgs),
      enhanceBudget,
      ctx?.signal,
    )
  } catch (error) {
    if (isTimeoutError(error)) return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)
    const message = error instanceof Error ? error.message : String(error)
    const classified = classifyFailure(message)
    return fail(classified ?? 'upstream', message)
  }

  const rawEnhance = rawContentOf(enhancedCall)
  const parsedReceipt = parseReceiptOutput(rawEnhance)
  if (parsedReceipt.invalidReceipt) {
    return fail('upstream', 'yce_enhance returned malformed <yce-receipt> JSON')
  }

  const receipt = parsedReceipt.receipt
  if (receipt !== null) {
    const receiptErrors = Array.isArray(receipt.errors) ? receipt.errors : []
    if (
      isFailure(enhancedCall, rawEnhance)
      || receipt.ok === false
      || (typeof receipt.exit_code === 'number' && receipt.exit_code !== 0)
      || receipt.enhanced?.success === false
    ) {
      return failFromYce(parsedReceipt.notes || rawEnhance, receiptErrors, 'yce_enhance failed')
    }

    const resultFile = typeof receipt.result_file === 'string' ? receipt.result_file.trim() : ''
    if (resultFile.length === 0) {
      return fail('upstream', 'yce_enhance receipt did not include result_file')
    }
    if (!picked.hasReadResult) {
      return fail(
        'mcp_missing',
        'yce_read_result tool is missing on the selected MCP server.',
      )
    }

    const xmlLines = []
    let offset = 1
    let pages = 0
    while (pages < MAX_READ_PAGES) {
      const readBudget = waitBudget(Date.now() - started)
      if (readBudget <= 0) return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)

      let pageResult
      try {
        pageResult = await raceTimeout(
          enso.mcp.call(picked.server, 'yce_read_result', {
            result_file: resultFile,
            offset,
            limit: READ_PAGE_LIMIT,
          }),
          readBudget,
          ctx?.signal,
        )
      } catch (error) {
        if (isTimeoutError(error)) return fail('timeout', ENHANCE_TIMEOUT_MESSAGE)
        const message = error instanceof Error ? error.message : String(error)
        return fail('upstream', message)
      }

      const rawPage = rawContentOf(pageResult)
      if (isFailure(pageResult, rawPage)) {
        return failFromYce(rawPage, receiptErrors, 'yce_read_result failed')
      }

      const page = parseReadResultPage(rawPage)
      if (page === null) {
        return fail('upstream', 'yce_read_result returned an unexpected page format')
      }

      xmlLines.push(...page.lines)
      pages += 1

      if (!page.meta.has_more) {
        if (page.meta.eof_reached !== true) {
          return fail('upstream', 'yce_read_result stopped before reaching EOF')
        }
        if (!page.meta.eof_verified && !page.meta.sentinel_ambiguous) {
          return fail('upstream', 'YCE result file failed EOF sentinel verification')
        }
        break
      }

      if (!Number.isInteger(page.meta.next_offset) || page.meta.next_offset <= offset) {
        return fail('upstream', 'yce_read_result returned an invalid next_offset')
      }
      offset = page.meta.next_offset
    }

    if (pages >= MAX_READ_PAGES) {
      return fail('upstream', 'YCE result file exceeded maximum pagination limit')
    }

    const xml = xmlLines.join('\n')
    const parsedXml = parseEnhancedXml(xml)
    if (parsedXml === null) {
      return fail('upstream', 'Failed to parse YCE XML result')
    }
    const mergedErrors = [...receiptErrors, ...parsedXml.errors]
    if (!parsedXml.present || !parsedXml.executed || !parsedXml.success) {
      return failFromYce(parsedReceipt.notes, mergedErrors, 'YCE enhancement did not succeed')
    }
    const enhancedText = parsedXml.prompt.trim()
    if (enhancedText.length === 0) {
      return failFromYce(parsedReceipt.notes, mergedErrors, 'yce_enhance returned an empty prompt')
    }
    return { ok: true, text: enhancedText }
  }

  // Fallback path: when writing result_file fails or CLI returns bare XML/errors.
  if (parsedReceipt.inlineXml !== null) {
    const parsedXml = parseEnhancedXml(parsedReceipt.inlineXml)
    if (parsedXml !== null && parsedXml.present && parsedXml.executed && parsedXml.success) {
      const enhancedText = parsedXml.prompt.trim()
      if (enhancedText.length > 0 && !isFailure(enhancedCall, rawEnhance)) {
        return { ok: true, text: enhancedText }
      }
    }
    return failFromYce(rawEnhance, parsedXml?.errors ?? [], 'yce_enhance failed')
  }

  if (isFailure(enhancedCall, rawEnhance)) {
    return failFromYce(rawEnhance, [], 'yce_enhance failed')
  }
  return fail('upstream', rawEnhance.trim() || 'yce_enhance returned an unrecognized response')
}

export function activate(enso) {
  enso.renderer.handle('enhance', (args, ctx) => enhance(enso, args, ctx))
  enso.renderer.handle('copy', (args) => copyText(enso, args))
}
