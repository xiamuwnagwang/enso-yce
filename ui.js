// Renderer module for EnsoCode (`ui.js`).
// Enso loads this file via a Blob URL, so it MUST NOT contain any `import` statements.
// Locale resolution: checks `enso.locale` / `enso.language` / `enso.lang` / `enso.i18n`,
// then `document.documentElement.lang`, then `navigator.languages`.

const en = {
  'wand.label': 'Enhance prompt with YCE',
  'wand.enhancing': 'Enhancing prompt…',
  'wand.empty': 'Enter a prompt first.',
  'wand.mcpMissing': 'yce-mcp is not configured: open Enso Settings → MCP to add it, or click "Copy MCP config" on the right (get your YCE Key at yce.aigy.de/console).',
  'wand.cliMissing': 'yce-mcp could not locate the YCE CLI: set YCE_MCP_SKILL_ROOT to your YCE-enhance directory in Enso Settings → MCP env.',
  'wand.authError': 'YCE_RELAY_TOKEN is missing or invalid: check Enso Settings → MCP (get your key at yce.aigy.de/console), or click "Copy MCP config".',
  'wand.quotaExceeded': 'YCE prompt enhancement quota is exhausted.',
  'wand.notDeployed': 'YCE skill is not initialized yet. Run install or set YCE_MCP_SKILL_ROOT in Settings → MCP.',
  'wand.timeout': 'Timed out (120s). Check network connectivity or YCE_TIMEOUT_ENHANCE_MS in your yce-mcp configuration.',
  'wand.draftChanged': 'The draft changed while enhancing, so it was not replaced.',
  'wand.upstream': 'Enhancement failed. Check MCP tool permissions and yce-mcp logs.',
  'wand.done': 'Prompt enhanced.',
  'wand.noRpc': 'Enhancement is not ready. Confirm yce.enhance is enabled in this profile and restart.',
  'wand.restore': 'Restore original',
  'wand.hasReferences': 'This draft has file or session references. Enso cannot replace the text while keeping those chips.',
  'wand.tooBig': 'The enhanced prompt exceeds Enso\'s 32KB draft limit, so it was not written back.',
  'wand.draftBusy': 'The composer is composing or locked. Try again in a moment.',
  'wand.noSession': 'Open a conversation first.',
  'wand.noComposer': 'The composer is not available in this window.',
  'wand.copy': 'Copy enhanced text',
  'wand.copied': 'Copied the enhanced prompt.',
  'wand.copyMcp': 'Copy MCP config',
  'wand.copiedMcp': 'Copied MCP config! Paste into Settings → MCP and fill in your YCE Key (yce.aigy.de/console).',
  'wand.copyFailed': 'Could not copy to the clipboard.',
}

const zh = {
  'wand.label': '用 YCE 增强提示词',
  'wand.enhancing': '提示词增强中…',
  'wand.empty': '请先输入提示词。',
  'wand.mcpMissing': '未配置 yce-mcp：打开 Enso 的 Settings → MCP 添加服务，或点击右侧「复制 MCP 配置」（到 yce.aigy.de/console 获取密钥）。',
  'wand.cliMissing': 'yce-mcp 未找到本地 YCE CLI：请在 Settings → MCP 环境变量中设置 YCE_MCP_SKILL_ROOT 指向 YCE-enhance 目录。',
  'wand.authError': 'YCE_RELAY_TOKEN 缺失或无效：请到 Settings → MCP 检查密钥（在 yce.aigy.de/console 获取），或点击右侧复制配置。',
  'wand.quotaExceeded': 'YCE 提示词增强额度已用尽。',
  'wand.notDeployed': 'YCE 尚未完成部署初始化，请在 Settings → MCP 中检查 YCE_MCP_SKILL_ROOT。',
  'wand.timeout': '增强已超时（120 秒）。请检查网络连接或 yce-mcp 的 YCE_TIMEOUT_ENHANCE_MS 配置。',
  'wand.draftChanged': '增强期间草稿已修改，未覆盖当前内容。',
  'wand.upstream': '增强失败。请检查 MCP 工具权限与 yce-mcp 日志。',
  'wand.done': '提示词已增强。',
  'wand.noRpc': '增强服务未就绪。请确认当前 profile 已启用 yce.enhance 并重启。',
  'wand.restore': '还原',
  'wand.hasReferences': '草稿含有文件或会话引用。Enso 暂不支持仅替换正文并保留引用标签，可点击右侧复制结果。',
  'wand.tooBig': '增强结果超过 Enso 的 32KB 草稿上限，未直接写回，可点击右侧复制结果。',
  'wand.draftBusy': '输入框正在组字或已锁定，请稍后再试。',
  'wand.noSession': '当前没有活跃会话。',
  'wand.noComposer': '当前窗口没有可用的输入框。',
  'wand.copy': '复制增强结果',
  'wand.copied': '已复制增强后的提示词。',
  'wand.copyMcp': '复制 MCP 配置',
  'wand.copiedMcp': '已复制 MCP 配置！请打开 Settings → MCP 粘贴，并填入 yce.aigy.de/console 的 YCE Key。',
  'wand.copyFailed': '无法写入剪贴板。',
}

export function buildMcpConfigSnippet(lang) {
  const placeholder = lang === 'zh'
    ? '替换为 https://yce.aigy.de/console 生成的 YCE Key'
    : 'Replace with your YCE Key from https://yce.aigy.de/console'
  return JSON.stringify(
    {
      mcpServers: {
        yce: {
          command: 'npx',
          args: ['--yes', 'yce-mcp@latest'],
          env: {
            YCE_RELAY_TOKEN: placeholder,
            YCE_TIMEOUT_NETWORK_MS: '90000',
            YCE_TIMEOUT_SEARCH_MS: '90000',
            YCE_TIMEOUT_ENHANCE_MS: '120000',
            YCE_TIMEOUT_AUTO_ENHANCE_MS: '120000',
            YCE_TIMEOUT_PLAN_MS: '300000',
          },
        },
      },
    },
    null,
    2,
  )
}

function needsMcpSetupHelp(code) {
  return code === 'mcp_missing' || code === 'auth_error' || code === 'cli_missing'
}

const tables = { en, zh }

function normalizeLocale(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function localeString(value) {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'function') {
    try {
      return localeString(value())
    } catch {
      return undefined
    }
  }
  if (value !== null && typeof value === 'object') {
    return localeString(value.locale ?? value.language ?? value.lang)
  }
  return undefined
}

/** Resolve Enso locale when exposed by host, falling back to document/navigator. */
export function pickLocale(enso, env) {
  const host = localeString(enso?.locale)
    ?? localeString(enso?.language)
    ?? localeString(enso?.lang)
    ?? localeString(enso?.i18n)
  if (host !== undefined) return normalizeLocale(host)
  const page = env?.documentLang ?? (typeof document !== 'undefined' ? document.documentElement?.lang : '')
  if (typeof page === 'string' && page.trim().length > 0) return normalizeLocale(page)
  const languages = env?.languages
    ?? (typeof navigator !== 'undefined'
      ? [...(navigator.languages ?? []), navigator.language].filter((item) => typeof item === 'string' && item.length > 0)
      : [])
  for (const language of languages) {
    if (typeof language === 'string' && language.trim().length > 0) return normalizeLocale(language)
  }
  return 'en'
}

export function messageFor(code, lang) {
  const table = tables[lang === 'zh' ? 'zh' : 'en']
  switch (code) {
    case 'mcp_missing': return table['wand.mcpMissing']
    case 'cli_missing': return table['wand.cliMissing']
    case 'auth_error': return table['wand.authError']
    case 'quota_exceeded': return table['wand.quotaExceeded']
    case 'not_deployed': return table['wand.notDeployed']
    case 'empty_prompt': return table['wand.empty']
    case 'no_rpc':
    case 'PLUGIN_DISABLED':
    case 'NOT_FOUND': return table['wand.noRpc']
    case 'draft_changed':
    case 'DRAFT_CHANGED': return table['wand.draftChanged']
    case 'DRAFT_HAS_REFERENCES': return table['wand.hasReferences']
    case 'TOO_LARGE': return table['wand.tooBig']
    case 'DRAFT_BUSY': return table['wand.draftBusy']
    case 'NO_SESSION': return table['wand.noSession']
    case 'NO_COMPOSER': return table['wand.noComposer']
    case 'TIMEOUT':
    case 'ABORTED':
    case 'timeout': return table['wand.timeout']
    case 'GESTURE_REQUIRED':
    case 'copy_failed': return table['wand.copyFailed']
    default: return table['wand.upstream']
  }
}

function codeOf(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
}

function isOversize(error) {
  const code = codeOf(error)
  if (code === 'TOO_LARGE') return true
  const message = error !== null && typeof error === 'object' && typeof error.message === 'string'
    ? error.message
    : ''
  return code === 'INVALID_ARGS' && /32\s?KB|32KB|过大/.test(message)
}

/**
 * Snapshot the composer draft, ask `main.mjs` to run `yce_enhance` + `yce_read_result`,
 * and write back only if both live draft text and Enso's `{ generation, rev }` match.
 */
export async function enhanceDraft(enso, sessionId, liveDraft, lang) {
  const language = lang === 'zh' ? 'zh' : 'en'
  let snap
  try {
    snap = await enso.composer.readDraft()
  } catch (error) {
    const code = codeOf(error) || 'upstream'
    return { ok: false, code, message: messageFor(code, language) }
  }
  const prompt = typeof snap?.text === 'string' ? snap.text.trim() : ''
  if (prompt.length === 0) {
    return { ok: false, code: 'empty_prompt', message: messageFor('empty_prompt', language) }
  }
  let result
  try {
    result = await enso.dispatch('plugin.call', { method: 'enhance', args: { prompt } })
  } catch (error) {
    const code = codeOf(error) || 'upstream'
    return {
      ok: false,
      code,
      message: messageFor(code, language),
      ...(needsMcpSetupHelp(code) ? { mcpConfigText: buildMcpConfigSnippet(language) } : {}),
    }
  }
  if (result?.ok !== true || typeof result.text !== 'string') {
    const code = typeof result?.code === 'string' ? result.code : 'upstream'
    return {
      ok: false,
      code,
      message: messageFor(code, language),
      ...(needsMcpSetupHelp(code) ? { mcpConfigText: buildMcpConfigSnippet(language) } : {}),
    }
  }
  const live = typeof liveDraft === 'function' ? liveDraft() : liveDraft
  if (String(live ?? '').trim() !== prompt) {
    return { ok: false, code: 'draft_changed', message: messageFor('draft_changed', language) }
  }
  try {
    await enso.composer.replaceDraft({
      text: result.text,
      expect: { generation: snap.generation, rev: snap.rev },
    })
  } catch (error) {
    const code = isOversize(error) ? 'TOO_LARGE' : (codeOf(error) || 'upstream')
    if (code === 'DRAFT_HAS_REFERENCES' || code === 'TOO_LARGE') {
      return { ok: false, code, message: messageFor(code, language), copyText: result.text }
    }
    return { ok: false, code, message: messageFor(code, language) }
  }
  return {
    ok: true,
    sessionId: sessionId ?? undefined,
    original: prompt,
    enhanced: result.text,
  }
}

/** Preserve the initial draft across consecutive enhancements in the same session. */
export function nextRestore(previous, sessionId, prompt, enhanced) {
  const sessionKey = sessionId ?? undefined
  const sameSession = previous === undefined
    || previous.sessionId === undefined
    || previous.sessionId === sessionKey
  const original = sameSession && previous !== undefined && prompt === previous.enhanced
    ? previous.original
    : prompt
  return { sessionId: sessionKey, original, enhanced }
}

export function canRestore(restore, sessionId, draft, running) {
  const sessionKey = sessionId ?? undefined
  return !running
    && restore !== undefined
    && restore !== null
    && (restore.sessionId === undefined || restore.sessionId === sessionKey)
    && draft !== restore.original
}

/** Auto-clear durations for finished status labels; busy/idle never auto-clear. */
export const STATUS_CLEAR_MS = { ok: 3500, error: 5000 }
const SETUP_CLEAR_MS = 15000

export const STYLE = `
.yceenso-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 25px;
  max-width: 380px;
}
.yceenso-control {
  position: relative;
  width: 25px;
  height: 25px;
  flex: none;
}
.yceenso-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 25px;
  height: 25px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md, 6px);
  background: var(--secondary, var(--muted, rgba(15, 23, 42, 0.05)));
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background-color 0.12s cubic-bezier(0.16, 1, 0.3, 1), color 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}
.yceenso-btn:hover {
  background: var(--accent, rgba(15, 23, 42, 0.08));
  color: var(--foreground);
}
.yceenso-btn:hover:active {
  transform: scale(0.96);
}
.yceenso-btn:disabled:not([data-busy='true']) {
  opacity: 0.45;
  cursor: not-allowed;
  color: var(--muted-foreground);
}
.yceenso-btn:disabled:not([data-busy='true']):hover {
  background: var(--secondary, var(--muted, rgba(15, 23, 42, 0.05)));
}
.yceenso-icon {
  width: 12.5px;
  height: 12.5px;
  display: block;
}
.yceenso-ring {
  position: absolute;
  z-index: 2;
  inset: 0;
  box-sizing: border-box;
  padding: 1.5px;
  border-radius: var(--radius-md, 6px);
  pointer-events: none;
  opacity: 0;
}
.yceenso-wrap[data-busy='true'] .yceenso-control {
  pointer-events: none;
}
.yceenso-wrap[data-busy='true'] .yceenso-ring {
  opacity: 0.85;
  animation: yceenso-spin 1.5s linear infinite;
  background: conic-gradient(
    from var(--yceenso-from, 0deg) at 50% 50%,
    transparent 0deg,
    rgba(247, 214, 186, 0) 205deg,
    rgba(247, 214, 186, 0.45) 255deg,
    rgba(232, 170, 120, 0.78) 305deg,
    rgba(201, 122, 69, 0.55) 340deg,
    transparent 360deg
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
}
.yceenso-btn[data-busy='true'] {
  opacity: 1;
  cursor: progress;
  pointer-events: none;
  color: #d9884e;
  background: var(--secondary, var(--muted, rgba(15, 23, 42, 0.05)));
}
.yceenso-btn[data-busy='true']:hover {
  color: #d9884e;
  background: var(--secondary, var(--muted, rgba(15, 23, 42, 0.05)));
}
@property --yceenso-from {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes yceenso-spin {
  to { --yceenso-from: 360deg; }
}
.yceenso-status {
  min-width: 0;
  max-width: 210px;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted-foreground, #8b8b8b);
  pointer-events: none;
}
.yceenso-status[data-level='busy'] {
  color: #d9884e;
}
.yceenso-status[data-level='error'] {
  color: var(--destructive, #e5484d);
}
.yceenso-status[data-level='ok'] {
  color: var(--success, #30a46c);
}
@media (prefers-reduced-motion: reduce) {
  .yceenso-wrap[data-busy='true'] .yceenso-ring {
    animation: none;
    opacity: 0.5;
  }
  .yceenso-btn,
  .yceenso-action {
    transition: none;
    animation: none;
  }
}
.yceenso-action {
  flex: none;
  height: 25px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 25px;
  white-space: nowrap;
  cursor: pointer;
}
.yceenso-action:hover {
  background: var(--accent, rgba(15, 23, 42, 0.08));
  color: var(--foreground);
}
.yceenso-action[data-accent='true'] {
  background: rgba(217, 136, 78, 0.14);
  color: #d9884e;
}
.yceenso-action[data-accent='true']:hover {
  background: rgba(217, 136, 78, 0.22);
  color: #c57238;
}
.yceenso-live {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`

let restoreSnap
const restoreListeners = new Set()

function getRestore() {
  return restoreSnap
}

function subscribeRestore(listener) {
  restoreListeners.add(listener)
  return () => { restoreListeners.delete(listener) }
}

function setRestore(next) {
  restoreSnap = next
  for (const listener of restoreListeners) listener()
}

/** YCE "Y" mark with a four-point sparkle in the top-right corner. */
function enhanceIcon(h) {
  return h('svg', {
    className: 'yceenso-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2.1',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
  },
    h('path', { d: 'M4.5 5L10.5 12L16.5 5M10.5 12V19.5' }),
    h('path', { d: 'M19.5 1.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z', fill: 'currentColor', strokeWidth: '1' }),
  )
}

export function onLoad(enso) {
  const { React } = enso
  const h = React.createElement.bind(React)
  const style = document.createElement('style')
  style.dataset.plugin = 'yce.enhance'
  style.textContent = STYLE
  document.head.appendChild(style)

  function EnhanceButton({ sessionId, draft }) {
    const text = typeof draft === 'string' ? draft : ''
    const [busy, setBusy] = React.useState(false)
    const [status, setStatus] = React.useState('')
    const [level, setLevel] = React.useState('idle')
    const [localeTick, setLocaleTick] = React.useState(0)
    const [copyText, setCopyText] = React.useState('')
    const [mcpConfigText, setMcpConfigText] = React.useState('')
    const lock = React.useRef(false)
    const draftRef = React.useRef(text)
    draftRef.current = text
    const levelRef = React.useRef(level)
    levelRef.current = level
    const snap = React.useSyncExternalStore(subscribeRestore, getRestore, getRestore)
    const lang = pickLocale(enso)
    const table = tables[lang]
    void localeTick

    React.useEffect(() => {
      const delay = mcpConfigText.length > 0 ? SETUP_CLEAR_MS : STATUS_CLEAR_MS[level]
      if (delay === undefined) return undefined
      const timer = window.setTimeout(() => {
        setStatus('')
        setLevel('idle')
        setMcpConfigText('')
      }, delay)
      return () => { window.clearTimeout(timer) }
    }, [level, status, mcpConfigText])

    React.useEffect(() => {
      if (levelRef.current !== 'error') return
      setStatus('')
      setLevel('idle')
      setMcpConfigText('')
    }, [text])

    React.useEffect(() => {
      const bump = () => { setLocaleTick((value) => value + 1) }
      window.addEventListener?.('languagechange', bump)
      return () => { window.removeEventListener?.('languagechange', bump) }
    }, [])

    const empty = text.trim().length === 0
    const disabled = busy || empty
    const title = empty ? table['wand.empty'] : (status.length > 0 ? status : table['wand.label'])

    const announce = (nextLevel, nextStatus) => {
      setStatus(nextStatus)
      setLevel(nextLevel)
    }

    const onClick = async () => {
      if (lock.current || draftRef.current.trim().length === 0) return
      lock.current = true
      setBusy(true)
      announce('busy', table['wand.enhancing'])
      setCopyText('')
      setMcpConfigText('')
      try {
        const result = await enhanceDraft(enso, sessionId, () => draftRef.current, lang)
        if (result.ok !== true) {
          setCopyText(typeof result.copyText === 'string' ? result.copyText : '')
          setMcpConfigText(typeof result.mcpConfigText === 'string' ? result.mcpConfigText : '')
          announce('error', result.message)
          return
        }
        const previous = getRestore()
        setRestore(nextRestore(previous, result.sessionId, result.original, result.enhanced))
        announce('ok', table['wand.done'])
      } finally {
        lock.current = false
        setBusy(false)
      }
    }

    const writeClipboard = async (value) => {
      try {
        const copied = await enso.dispatch('plugin.call', { method: 'copy', args: { text: value } })
        if (copied?.ok === true) return { ok: true }
      } catch {
        // fallback below
      }
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(value)
          return { ok: true }
        } catch {
          // fallthrough
        }
      }
      return { ok: false, code: 'copy_failed' }
    }

    const onCopy = async () => {
      if (copyText.length === 0 || lock.current) return
      const res = await writeClipboard(copyText)
      if (res.ok) {
        setCopyText('')
        announce('ok', table['wand.copied'])
        return
      }
      announce('error', messageFor(res.code || 'copy_failed', lang))
    }

    const onCopyMcp = async () => {
      if (mcpConfigText.length === 0 || lock.current) return
      const res = await writeClipboard(mcpConfigText)
      if (res.ok) {
        setMcpConfigText('')
        announce('ok', table['wand.copiedMcp'])
        return
      }
      announce('error', messageFor(res.code || 'copy_failed', lang))
    }

    const onRestore = async () => {
      const current = getRestore()
      if (current === undefined || lock.current) return
      try {
        await enso.composer.replaceDraft({ text: current.original })
        setRestore(undefined)
        announce('idle', '')
      } catch (error) {
        announce('error', messageFor(codeOf(error) || 'upstream', lang))
      }
    }

    const showRestore = canRestore(snap, sessionId, text, busy)

    return h('span', {
      className: 'yceenso-wrap',
      'data-empty': empty ? 'true' : 'false',
      'data-busy': busy ? 'true' : 'false',
      title,
    },
      h('span', { className: 'yceenso-control' },
        h('span', { className: 'yceenso-ring', 'aria-hidden': true }),
        h('button', {
          type: 'button',
          className: 'yceenso-btn',
          'data-busy': busy ? 'true' : 'false',
          disabled,
          title,
          'aria-label': title,
          'aria-busy': busy,
          onMouseDown: (event) => { event.preventDefault() },
          onClick: () => { void onClick() },
        }, enhanceIcon(h)),
      ),
      status.length > 0 ? h('span', { className: 'yceenso-status', 'data-level': level }, status) : null,
      showRestore ? h('button', {
        type: 'button',
        className: 'yceenso-action',
        title: table['wand.restore'],
        onMouseDown: (event) => { event.preventDefault() },
        onClick: () => { void onRestore() },
      }, table['wand.restore']) : null,
      copyText.length > 0 && !busy ? h('button', {
        type: 'button',
        className: 'yceenso-action',
        title: table['wand.copy'],
        onMouseDown: (event) => { event.preventDefault() },
        onClick: () => { void onCopy() },
      }, table['wand.copy']) : null,
      mcpConfigText.length > 0 && !busy ? h('button', {
        type: 'button',
        className: 'yceenso-action',
        'data-accent': 'true',
        title: table['wand.mcpMissing'],
        onMouseDown: (event) => { event.preventDefault() },
        onClick: () => { void onCopyMcp() },
      }, table['wand.copyMcp']) : null,
      h('span', { className: 'yceenso-live', 'aria-live': 'polite' }, status),
    )
  }

  enso.slots.register({ slot: 'composer.left', component: EnhanceButton })
  return () => { style.remove() }
}
