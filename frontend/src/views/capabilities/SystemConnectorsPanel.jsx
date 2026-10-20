import { useMemo, useState } from 'react'
import {
  Monitor,
  Terminal,
  FolderTree,
  Globe,
  Cpu,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  ShieldCheck,
  Server,
} from 'lucide-react'
import { useApp } from '../../store.jsx'
import McpServersPanel from './McpServersPanel.jsx'
import '../../styles/connectors.css'

const SYSTEM_TOOLS = [
  {
    slug: 'cua-driver',
    name: 'Desktop Automation (CUA Driver)',
    category: 'Native OS',
    desc: 'Direct GUI automation across macOS, Windows, and Linux via accessibility tree, mouse & keyboard simulation, and window frame management.',
    icon: Monitor,
    iconBg: 'rgba(113, 50, 245, 0.12)',
    iconColor: 'var(--accent, #7132f5)',
    status: 'Built-in · Active',
    capabilities: ['Screen Control', 'Accessibility Tree', 'Window Management'],
    prompt: 'Check current desktop windows and show active applications using CUA driver.',
  },
  {
    slug: 'bash',
    name: 'System Terminal & Shell',
    category: 'System Core',
    desc: 'Local command line execution with persistent pseudo-terminals, background daemon support, and process lifecycle management.',
    icon: Terminal,
    iconBg: 'rgba(20, 158, 97, 0.12)',
    iconColor: 'var(--live, #149e61)',
    status: 'Built-in · Active',
    capabilities: ['Subprocesses', 'Persistent Terminals', 'Background Jobs'],
    prompt: 'Run git status and summarize the latest changes in the repository.',
  },
  {
    slug: 'filesystem',
    name: 'Workspace Filesystem',
    category: 'System Core',
    desc: 'High-speed local workspace reading, line-exact file updates, fd pattern indexing, and ripgrep text search with atomic guarantees.',
    icon: FolderTree,
    iconBg: 'rgba(59, 130, 246, 0.12)',
    iconColor: '#3b82f6',
    status: 'Built-in · Active',
    capabilities: ['Ripgrep Search', 'Atomic Edits', 'AST Inspection'],
    prompt: 'Search the codebase for connector definitions and summarize file locations.',
  },
  {
    slug: 'browser',
    name: 'Web Browser & Page Scraper',
    category: 'Web & Scraping',
    desc: 'Headless Chromium browser automation, full-page screenshot capture, interactive form filling, and clean markdown text extraction.',
    icon: Globe,
    iconBg: 'rgba(245, 158, 11, 0.12)',
    iconColor: '#f59e0b',
    status: 'Built-in · Active',
    capabilities: ['DOM Navigation', 'Markdown Extraction', 'Screenshotting'],
    prompt: 'Extract and summarize the main documentation from https://modelcontextprotocol.io',
  },
  {
    slug: 'uv-runtime',
    name: 'Python Runtime (uv)',
    category: 'Language Runtime',
    desc: 'Standalone hermetic uv package manager in ~/.amethyst/bin for isolated Python tool execution without modifying system packages.',
    icon: Cpu,
    iconBg: 'rgba(168, 85, 247, 0.12)',
    iconColor: '#a855f7',
    status: 'Runtime Ready',
    capabilities: ['Hermetic venv', 'Fast Package Runner', 'PEP 508'],
    prompt: 'Verify Python and uv environment and check installed packages.',
  },
]

export default function SystemConnectorsPanel({ query = '', newOpen, setNewOpen }) {
  const { openChatWithPrompt } = useApp()
  const [selectedTool, setSelectedTool] = useState(null)

  const effectiveQuery = query.trim().toLowerCase()

  const filteredTools = useMemo(() => {
    if (!effectiveQuery) return SYSTEM_TOOLS
    return SYSTEM_TOOLS.filter(
      (t) =>
        t.name.toLowerCase().includes(effectiveQuery) ||
        t.desc.toLowerCase().includes(effectiveQuery) ||
        t.capabilities.some((c) => c.toLowerCase().includes(effectiveQuery))
    )
  }, [effectiveQuery])

  const handleLaunchChat = (prompt) => {
    openChatWithPrompt(prompt)
  }

  return (
    <div className="system-connectors-root">
      {/* ── Native System Capabilities Section ── */}
      <section className="system-connectors-section">
        <div className="system-section-header">
          <div>
            <h2 className="system-section-title">Built-in System Tools</h2>
            <p className="system-section-desc">
              Core platform tools running natively on your local machine with zero external account requirements.
            </p>
          </div>
          <span className="system-badge-count">
            {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
          </span>
        </div>

        <div className="system-tools-grid">
          {filteredTools.map((tool) => {
            const IconComponent = tool.icon
            return (
              <div key={tool.slug} className="system-tool-card">
                <div className="system-card-head">
                  <div
                    className="system-card-icon"
                    style={{ background: tool.iconBg, color: tool.iconColor }}
                  >
                    <IconComponent size={20} />
                  </div>
                  <div className="system-card-meta">
                    <div className="system-card-title-row">
                      <span className="system-card-title">{tool.name}</span>
                      <span className="system-status-pill is-active">
                        <span className="system-status-dot is-live" />
                        {tool.status}
                      </span>
                    </div>
                    <span className="system-card-category">{tool.category}</span>
                  </div>
                </div>

                <p className="system-card-desc">{tool.desc}</p>

                <div className="system-card-caps">
                  {tool.capabilities.map((cap) => (
                    <span key={cap} className="system-cap-tag">
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="system-card-footer">
                  <button
                    type="button"
                    className="system-btn-action"
                    onClick={() => handleLaunchChat(tool.prompt)}
                    title={`Test ${tool.name} in chat`}
                  >
                    <MessageSquare size={13} />
                    <span>Test in Chat</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Custom MCP Servers Section ── */}
      <section className="system-mcp-section">
        <div className="system-section-header">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-accent" />
            <div>
              <h2 className="system-section-title">Custom MCP Servers</h2>
              <p className="system-section-desc">
                Extend Amethyst with custom stdio command tools or remote HTTP/SSE Model Context Protocol servers.
              </p>
            </div>
          </div>
        </div>

        <McpServersPanel
          embedded={true}
          newOpen={newOpen}
          setNewOpen={setNewOpen}
          query={query}
        />
      </section>
    </div>
  )
}
