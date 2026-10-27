import { Button as HouseButton } from '../ui/bento/index.jsx'
import { useEffect, useMemo, useRef, useState, useId } from 'react'
import Icon from '../Icon.jsx'
import { PIN_CSP, pinnedHtml } from './pinnedSandbox.js'

export default function SandboxedUi({ data, pinned = false }) {
  const instanceId = useId()
  const iframeRef = useRef(null)
  const initialHeight = Math.min(Math.max(Number(data?.initial_height) || 400, 240), 850)
  const [height, setHeight] = useState(initialHeight)
  const [reloadKey, setReloadKey] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  // Listen for resize and selection postMessages from inside the iframe
  useEffect(() => {
    function handleMessage(e) {
      if (pinned || e.source !== iframeRef.current?.contentWindow || e.data?.id !== instanceId) return
      if (e.data?.type === 'amethyst:sandboxed-ui:resize') {
        const measured = Math.round(Number(e.data.height))
        if (measured > 140 && measured < 1500) {
          setHeight(measured)
        }
      } else if (e.data?.type === 'amethyst:sandboxed-ui:selection') {
        const iframeEl = iframeRef.current
        if (iframeEl && e.data?.rect) {
          const iRect = iframeEl.getBoundingClientRect()
          const screenRect = {
            top: iRect.top + e.data.rect.top,
            left: iRect.left + e.data.rect.left,
            right: iRect.left + e.data.rect.right,
            bottom: iRect.top + e.data.rect.bottom,
            width: e.data.rect.width,
            height: e.data.rect.height,
          }
          window.dispatchEvent(
            new CustomEvent('amethyst:external-selection', {
              detail: {
                text: e.data.text,
                rect: screenRect,
                sourceId: instanceId,
                onFormat: (cmd) => {
                  iframeEl.contentWindow?.postMessage(
                    {
                      type: 'amethyst:sandboxed-ui:format-command',
                      id: instanceId,
                      command: cmd,
                    },
                    '*'
                  )
                },
              },
            })
          )
        }
      } else if (e.data?.type === 'amethyst:sandboxed-ui:selection-cleared') {
        window.dispatchEvent(
          new CustomEvent('amethyst:external-selection-cleared', {
            detail: { sourceId: instanceId },
          })
        )
      }
    }
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      window.dispatchEvent(
        new CustomEvent('amethyst:external-selection-cleared', {
          detail: { sourceId: instanceId },
        })
      )
    }
  }, [instanceId, pinned])

  // Build the complete srcdoc HTML with dynamic theme variables
  const srcDoc = useMemo(() => {
    const rawHtml = pinned ? pinnedHtml(data?.html || '') : data?.html || ''
    const rawCss = pinned ? (data?.css || '').replaceAll('<', '\\3c ') : data?.css || ''
    const rawJs = pinned ? '' : data?.js || ''
    const scripts = !pinned && Array.isArray(data?.scripts) ? data.scripts : []

    const root = typeof document !== 'undefined' ? document.documentElement : null
    const style = typeof window !== 'undefined' && root ? window.getComputedStyle(root) : null
    const theme = root?.getAttribute('data-theme') || 'dark'
    const themeMode = root?.getAttribute('data-theme-mode') || (root?.classList.contains('light') ? 'light' : 'dark')

    const canvas = style?.getPropertyValue('--canvas')?.trim() || (themeMode === 'light' ? '#ffffff' : '#101114')
    const canvasDeep = style?.getPropertyValue('--canvas-deep')?.trim() || (themeMode === 'light' ? '#f8f9fa' : '#0a0a0c')
    const surface = style?.getPropertyValue('--surface')?.trim() || (themeMode === 'light' ? '#f3f4f6' : '#18191e')
    const surface2 = style?.getPropertyValue('--surface-2')?.trim() || (themeMode === 'light' ? '#e5e7eb' : '#22232a')
    const surface3 = style?.getPropertyValue('--surface-3')?.trim() || (themeMode === 'light' ? '#d1d5db' : '#2c2e37')
    const text = style?.getPropertyValue('--text')?.trim() || (themeMode === 'light' ? '#101114' : '#e8e8f0')
    const textDim = style?.getPropertyValue('--text-dim')?.trim() || (themeMode === 'light' ? '#64748b' : '#94a3b8')
    const accent = style?.getPropertyValue('--accent')?.trim() || '#7132f5'
    const accentSoft = style?.getPropertyValue('--accent-soft')?.trim() || 'rgba(113, 50, 245, 0.12)'
    const border = style?.getPropertyValue('--hairline')?.trim() || style?.getPropertyValue('--border')?.trim() || (themeMode === 'light' ? '#dedee5' : '#272730')
    const live = style?.getPropertyValue('--live')?.trim() || '#149e61'
    const stop = style?.getPropertyValue('--stop')?.trim() || '#ef4444'
    const confirm = style?.getPropertyValue('--confirm')?.trim() || '#f59e0b'
    const fontSans = style?.getPropertyValue('--font-sans')?.trim() || 'Inter, system-ui, -apple-system, sans-serif'
    const fontMono = style?.getPropertyValue('--font-mono')?.trim() || "'Geist Mono', ui-monospace, monospace"

    const scriptTags = scripts
      .filter((src) => typeof src === 'string' && src.startsWith('http'))
      .map((src) => `<script src="${src}" crossorigin="anonymous"></script>`)
      .join('\n')

    return `<!DOCTYPE html>
<html lang="en" class="${themeMode === 'dark' ? 'dark dark-mode' : 'light'}" data-theme="${theme}" data-theme-mode="${themeMode}" style="color-scheme: ${themeMode};">
<head>
  ${pinned ? `<meta http-equiv="Content-Security-Policy" content="${PIN_CSP}">` : ''}
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: ${themeMode};
      --canvas: ${canvas};
      --canvas-deep: ${canvasDeep};
      --surface: ${surface};
      --surface-2: ${surface2};
      --surface-3: ${surface3};
      --text: ${text};
      --text-dim: ${textDim};
      --accent: ${accent};
      --accent-soft: ${accentSoft};
      --border: ${border};
      --hairline: ${border};
      --live: ${live};
      --stop: ${stop};
      --confirm: ${confirm};
      --font-sans: ${fontSans};
      --font-mono: ${fontMono};
      --radius-cards: 10px;
      --radius-inputs: 9999px;
      --radius-buttons: 9999px;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 14px 18px;
      background: transparent;
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      overflow-x: hidden;
      overflow-y: auto;
    }
    /* Elegant modern scrollbars */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

    /* Control resets */
    button, input, select, textarea {
      font-family: inherit;
      font-size: inherit;
      color: inherit;
    }
    button {
      cursor: pointer;
    }
    input[type="range"] {
      accent-color: var(--accent);
    }
    input[type="checkbox"], input[type="radio"] {
      accent-color: var(--accent);
    }

    /* Style duplicate first-child h1 smoothly if model generated title in HTML */
    h1:first-child {
      margin-top: 0;
      margin-bottom: 6px;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.015em;
    }

    ${rawCss}
  </style>
  ${scriptTags}
</head>
<body>
  ${rawHtml}
  <script>
    (function() {
      const INSTANCE_ID = ${JSON.stringify(instanceId)};
      function notifyHeight() {
        try {
          const bodyH = document.body ? document.body.scrollHeight : 0;
          const docH = document.documentElement ? document.documentElement.scrollHeight : 0;
          const h = Math.max(bodyH, docH, 150);
          window.parent.postMessage({
            type: 'amethyst:sandboxed-ui:resize',
            id: INSTANCE_ID,
            height: h
          }, '*');
        } catch (e) {}
      }

      window.addEventListener('load', notifyHeight);
      window.addEventListener('resize', notifyHeight);

      if (window.ResizeObserver && document.body) {
        const ro = new ResizeObserver(notifyHeight);
        ro.observe(document.body);
      }

      function handleIframeSelection() {
        try {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || !sel.rangeCount) {
            window.parent.postMessage({
              type: 'amethyst:sandboxed-ui:selection-cleared',
              id: INSTANCE_ID
            }, '*');
            return;
          }
          const text = sel.toString().trim();
          if (text.length < 2) {
            window.parent.postMessage({
              type: 'amethyst:sandboxed-ui:selection-cleared',
              id: INSTANCE_ID
            }, '*');
            return;
          }
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          window.parent.postMessage({
            type: 'amethyst:sandboxed-ui:selection',
            id: INSTANCE_ID,
            text: text,
            rect: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height
            }
          }, '*');
        } catch (e) {}
      }

      document.addEventListener('selectionchange', handleIframeSelection);
      document.addEventListener('mouseup', handleIframeSelection);
      document.addEventListener('keyup', handleIframeSelection);

      window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'amethyst:sandboxed-ui:format-command' && e.data.id === INSTANCE_ID) {
          try {
            document.execCommand(e.data.command, false, null);
          } catch (err) {}
        }
      });

      // Safe script execution
      try {
        ${rawJs}
      } catch (err) {
        console.error('Sandboxed UI runtime error:', err);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color: #dc2626; background: rgba(220,38,38,0.08); padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-top: 12px; font-family: monospace;';
        errDiv.textContent = 'Runtime error: ' + (err.message || String(err));
        document.body.appendChild(errDiv);
      }

      setTimeout(notifyHeight, 80);
      setTimeout(notifyHeight, 500);
    })();
  </script>
</body>
</html>`
  }, [data, instanceId, pinned])

  const copyCode = () => {
    const combined = `<!-- HTML -->\n${data?.html || ''}\n\n/* CSS */\n${data?.css || ''}\n\n// JavaScript\n${data?.js || ''}`
    navigator.clipboard.writeText(combined).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const title = data?.title || 'Interactive Application'

  return (
    <div className="sandboxed-ui-container">
      <div className="sandboxed-ui-toolbar">
        <div className="sandboxed-ui-title-wrap">
          <Icon name="sparkle" size={13} className="sandboxed-ui-sparkle" />
          <span className="sandboxed-ui-title" title={title}>
            {title}
          </span>
        </div>
        <div className="sandboxed-ui-actions">
          <HouseButton
            type="button"
            className="sandboxed-ui-action-btn"
            title="Copy component code"
            onClick={copyCode}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            <span>{copied ? 'Copied' : 'Code'}</span>
          </HouseButton>
          <HouseButton
            type="button"
            className="sandboxed-ui-action-btn"
            title="Reload component"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <Icon name="refresh" size={12} />
          </HouseButton>
          <HouseButton
            type="button"
            className="sandboxed-ui-action-btn"
            title={expanded ? 'Collapse height' : 'Expand height'}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size={12} />
          </HouseButton>
        </div>
      </div>
      <div className="sandboxed-ui-frame">
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title={title}
          sandbox={pinned ? '' : 'allow-scripts allow-forms'}
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          className="sandboxed-ui-iframe"
          style={{
            width: '100%',
            height: expanded ? 660 : height,
            border: 'none',
            display: 'block',
            background: 'transparent',
            transition: 'height 140ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        />
      </div>
    </div>
  )
}
