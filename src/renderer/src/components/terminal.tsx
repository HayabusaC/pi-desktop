import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store'
import { useAppliedThemeId } from '../hooks'
import { DEFAULT_SETTINGS } from '../../../shared/default-settings'
import type { TerminalShellId, TerminalShellOption } from '../../../shared/ipc-contracts'
import { clsx } from 'clsx'
import {
  Terminal as TerminalIcon,
  X,
  Maximize2,
  Minimize2,
  Trash2,
} from 'lucide-react'

const TERMINAL_SHELL_STORAGE_KEY = 'pi-desktop:terminal-shell'
const TERMINAL_SHELL_LABELS: Record<TerminalShellId, string> = {
  system: 'Shell',
  cmd: 'CMD',
  powershell: 'PowerShell',
  wsl: 'WSL',
}

// Build the xterm color theme from the active app theme's CSS variables so the
// terminal matches whichever theme (dark/light/nord/gruvbox/breeze) is applied.
// Falls back to the dark palette if a variable is missing.
function buildTerminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim()
    return value || fallback
  }

  const bg = v('--color-app', '#0a0a0a')
  const fg = v('--color-primary', '#d4d4d4')

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    selectionBackground: v('--cm-selection-bg', '#3b82f666'),
    black: bg,
    red: v('--color-error', '#ef4444'),
    green: v('--color-success', '#22c55e'),
    yellow: v('--color-warning', '#eab308'),
    blue: v('--color-accent', '#3b82f6'),
    magenta: v('--cm-keyword', '#a855f7'),
    cyan: v('--cm-link', '#06b6d4'),
    white: fg,
    brightBlack: v('--color-muted', '#525252'),
    brightRed: v('--color-error', '#f87171'),
    brightGreen: v('--color-success', '#4ade80'),
    brightYellow: v('--color-warning', '#facc15'),
    brightBlue: v('--color-accent', '#60a5fa'),
    brightMagenta: v('--cm-keyword', '#c084fc'),
    brightCyan: v('--cm-link', '#22d3ee'),
    brightWhite: v('--color-secondary', '#ffffff'),
  }
}

export function TerminalPanel(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const toggleTerminal = useAppStore((state) => state.toggleTerminal)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const appliedThemeId = useAppliedThemeId()

  const [maximized, setMaximized] = useState(false)
  const [shellLabel, setShellLabel] = useState<string | null>(null)
  const [shellOptions, setShellOptions] = useState<TerminalShellOption[]>([])
  const [selectedShell, setSelectedShell] = useState<TerminalShellId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!terminalOpen) return
    let cancelled = false
    void window.piDesktop.terminal.shells().then((options) => {
      if (cancelled) return
      setShellOptions(options)
      let remembered: TerminalShellId | null = null
      try {
        const value = window.localStorage.getItem(TERMINAL_SHELL_STORAGE_KEY)
        if (value === 'system' || value === 'cmd' || value === 'powershell' || value === 'wsl') remembered = value
      } catch {
        // Storage may be unavailable in hardened renderer sessions.
      }
      const selected = options.find((option) => option.id === remembered && option.available)
        ?? options.find((option) => option.available)
      setSelectedShell(selected?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [terminalOpen])

  useEffect(() => {
    if (!terminalOpen || !containerRef.current || !selectedShell) return

    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      // Use the Terminal Font Size setting (or the unsaved settings draft),
      // read once at creation. Applied on the next mount — i.e. when the user
      // returns to chat — rather than live, to avoid resizing a hidden pty.
      // Falls back to the default.
      fontSize:
        useAppStore.getState().settingsDraft.terminalFontSize ??
        useAppStore.getState().settings?.terminalFontSize ??
        DEFAULT_SETTINGS.terminalFontSize,
      theme: buildTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitRef.current = fit

    const fitAndResize = () => {
      fit.fit()
      window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
    }

    const dataDisposable = terminal.onData((data) => {
      window.piDesktop.terminal.input(data)
    })
    const outputCleanup = window.piDesktop.terminal.onData((data) => {
      terminal.write(data)
    })
    const exitCleanup = window.piDesktop.terminal.onExit((event) => {
      terminal.writeln('')
      terminal.writeln(i18n.t('terminal.processExited', { code: event.exitCode }))
    })

    const startTimer = window.setTimeout(async () => {
      fitAndResize()
      try {
        const result = await window.piDesktop.terminal.start({
          cwd: activeWorkspace?.path,
          cols: terminal.cols,
          rows: terminal.rows,
          shell: selectedShell,
        })
        setShellLabel(result.shell.split(/[\\/]/).pop() ?? result.shell)
      } catch (err) {
        terminal.writeln(i18n.t('terminal.startFailed', { detail: err instanceof Error ? err.message : String(err) }))
      }
      terminal.focus()
    }, 0)

    window.addEventListener('resize', fitAndResize)

    return () => {
      window.removeEventListener('resize', fitAndResize)
      window.clearTimeout(startTimer)
      dataDisposable.dispose()
      outputCleanup()
      exitCleanup()
      window.piDesktop.terminal.stop()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [terminalOpen, activeWorkspace?.path, selectedShell, i18n])

  const selectShell = (shell: TerminalShellId): void => {
    setShellLabel(null)
    setSelectedShell(shell)
    try {
      window.localStorage.setItem(TERMINAL_SHELL_STORAGE_KEY, shell)
    } catch {
      // The selection still applies to this window when storage is unavailable.
    }
  }

  useEffect(() => {
    if (!terminalOpen) return
    window.setTimeout(() => {
      fitRef.current?.fit()
      const terminal = terminalRef.current
      if (terminal) {
        window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
      }
    }, 0)
  }, [terminalOpen, maximized])

  // Recolor the live terminal when the app theme changes, without recreating it.
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = buildTerminalTheme()
    }
  }, [appliedThemeId])

  if (!terminalOpen) return null

  return (
    <div
      className={clsx(
        'flex flex-col border-t border-border bg-app',
        maximized ? 'flex-1' : 'h-64'
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <TerminalIcon size={14} className="text-dim" />
          <span className="text-xs text-muted">{t('terminal.title')}</span>
          {shellOptions.length > 1 ? (
            <select
              value={selectedShell ?? ''}
              onChange={(event) => selectShell(event.target.value as TerminalShellId)}
              className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-secondary outline-none hover:border-border-strong"
              title={t('terminal.selectShell')}
              aria-label={t('terminal.selectShell')}
            >
              {shellOptions.map((option) => (
                <option key={option.id} value={option.id} disabled={!option.available}>
                  {TERMINAL_SHELL_LABELS[option.id]}{option.available ? '' : ` (${t('terminal.unavailable')})`}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[10px] text-faint">{shellLabel ?? t('terminal.title')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => terminalRef.current?.clear()}
            className="rounded p-1 text-faint hover:text-muted transition-colors"
            title={t('terminal.clearTitle')}
            aria-label={t('terminal.clearAriaLabel')}
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={() => setMaximized(!maximized)}
            className="rounded p-1 text-faint hover:text-muted transition-colors"
            title={maximized ? t('terminal.restoreLabel') : t('terminal.maximizeLabel')}
            aria-label={maximized ? t('terminal.restoreLabel') : t('terminal.maximizeLabel')}
          >
            {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={toggleTerminal}
            className="rounded p-1 text-faint hover:text-muted transition-colors"
            title={t('terminal.closeTitle')}
            aria-label={t('terminal.closeTitle')}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
    </div>
  )
}
