import { Button as HouseButton } from '../components/ui/bento/index.jsx'
import { useApp } from '../store.jsx'
import Icon from '../components/Icon.jsx'
import './code.css'

export default function Code() {
  const { workspace, toast } = useApp()

  const workspaceName = workspace
    ? workspace.split('/').filter(Boolean).pop() || workspace
    : 'No workspace selected'

  const copyIssueLink = () => {
    navigator.clipboard?.writeText('https://github.com/Wayn-Git/Amethyst/issues/70')
    toast('Issue #70 link copied to clipboard', 'good')
  }

  return (
    <div className="agents-manager-view">
      {/* Top Banner / Hero Header */}
      <header className="agents-hero">
        <div className="agents-hero-meta">
          <span className="agents-badge-dev">
            <span className="agents-badge-dot" />
            In Development
          </span>
          <span className="agents-badge-pill">Amethyst Engine</span>
        </div>

        <h1 className="agents-hero-title">Coding Agents Manager</h1>
        <p className="agents-hero-desc">
          A unified cockpit for autonomous coding agents. Orchestrate Google AntiGravity,
          Anthropic Claude Code, OpenAI Codex, and Aider across concurrent workspaces,
          multi-session worktrees, and native execution streams.
        </p>

        <div className="agents-hero-actions">
          <a
            href="https://github.com/Wayn-Git/Amethyst/issues/70"
            target="_blank"
            rel="noopener noreferrer"
            className="agents-btn agents-btn-primary"
          >
            <Icon name="github" size={15} />
            <span>Track Architecture on GitHub (#70)</span>
            <Icon name="arrow-up-right" size={13} />
          </a>

          <HouseButton
            type="button"
            className="agents-btn agents-btn-secondary"
            onClick={copyIssueLink}
          >
            <Icon name="copy" size={14} />
            <span>Copy Issue Link</span>
          </HouseButton>
        </div>
      </header>

      {/* Workspace Context Strip */}
      <section className="agents-context-strip">
        <div className="agents-context-item">
          <Icon name="folder" size={15} className="agents-context-icon" />
          <span className="agents-context-label">Active Workspace:</span>
          <code className="agents-context-path" title={workspace || 'None'}>
            {workspaceName}
          </code>
        </div>
        <div className="agents-context-divider" />
        <div className="agents-context-item">
          <Icon name="branch" size={14} className="agents-context-icon" />
          <span className="agents-context-label">Concurrency:</span>
          <span className="agents-context-value">Multi-session worktree isolation</span>
        </div>
        <div className="agents-context-divider" />
        <div className="agents-context-item">
          <Icon name="terminal" size={14} className="agents-context-icon" />
          <span className="agents-context-label">Runtime:</span>
          <span className="agents-context-value">Native PTY / Subprocess Streams</span>
        </div>
      </section>

      {/* Main Content Sections */}
      <main className="agents-content-grid">
        {/* Planned Engines */}
        <section className="agents-section">
          <div className="agents-section-header">
            <h2 className="agents-section-title">
              <Icon name="cpu" size={16} />
              <span>Supported Agent Engines</span>
            </h2>
            <span className="agents-section-sub">Unified drivers & subprocess harnesses</span>
          </div>

          <div className="agents-cards-grid">
            <div className="agents-card">
              <div className="agents-card-top">
                <div className="agents-card-icon-box">
                  <Icon name="google" size={18} />
                </div>
                <div className="agents-card-meta">
                  <h3 className="agents-card-title">Google AntiGravity</h3>
                  <span className="agents-tag">Advanced Coding</span>
                </div>
              </div>
              <p className="agents-card-text">
                Native integration with the <code>agy</code> CLI, IDE sidecars, specialized subagents
                (cavecrew, parallel dispatch), and custom MCP server plugins.
              </p>
              <div className="agents-card-status">
                <span className="agents-status-indicator planned" />
                <span>Adapter specification in progress</span>
              </div>
            </div>

            <div className="agents-card">
              <div className="agents-card-top">
                <div className="agents-card-icon-box">
                  <Icon name="terminal" size={18} />
                </div>
                <div className="agents-card-meta">
                  <h3 className="agents-card-title">Anthropic Claude Code</h3>
                  <span className="agents-tag">CLI Subagents</span>
                </div>
              </div>
              <p className="agents-card-text">
                Headless and interactive <code>claude</code> CLI execution with streaming tool calls,
                slash command forwarding, and automated prompt hooks.
              </p>
              <div className="agents-card-status">
                <span className="agents-status-indicator planned" />
                <span>Harness architecture planned</span>
              </div>
            </div>

            <div className="agents-card">
              <div className="agents-card-top">
                <div className="agents-card-icon-box">
                  <Icon name="sparkle" size={18} />
                </div>
                <div className="agents-card-meta">
                  <h3 className="agents-card-title">OpenAI Codex / Operator</h3>
                  <span className="agents-tag">Autonomous Synthesis</span>
                </div>
              </div>
              <p className="agents-card-text">
                Direct agentic loop for test-driven synthesis, mechanical refactoring, and
                continuous pull-request code reviews.
              </p>
              <div className="agents-card-status">
                <span className="agents-status-indicator planned" />
                <span>Connector planned</span>
              </div>
            </div>

            <div className="agents-card">
              <div className="agents-card-top">
                <div className="agents-card-icon-box">
                  <Icon name="code" size={18} />
                </div>
                <div className="agents-card-meta">
                  <h3 className="agents-card-title">Aider & Local Models</h3>
                  <span className="agents-tag">Git Pair Programming</span>
                </div>
              </div>
              <p className="agents-card-text">
                Model-agnostic CLI pair programming with AST repository maps, architect/editor
                two-stage workflows, and local Ollama/vLLM weights.
              </p>
              <div className="agents-card-status">
                <span className="agents-status-indicator planned" />
                <span>Connector planned</span>
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section className="agents-section">
          <div className="agents-section-header">
            <h2 className="agents-section-title">
              <Icon name="grid" size={16} />
              <span>Core Architecture Pillars</span>
            </h2>
            <span className="agents-section-sub">Replacing slow iframes with native capability</span>
          </div>

          <div className="agents-pillars-grid">
            <div className="agents-pillar-card">
              <div className="agents-pillar-header">
                <Icon name="branch" size={16} />
                <h4>Concurrent Multi-Session</h4>
              </div>
              <p>
                Run multiple agents in parallel across separate Git worktrees. Debug an API issue
                with AntiGravity in one worktree while Claude refactors a UI component in another.
              </p>
            </div>

            <div className="agents-pillar-card">
              <div className="agents-pillar-header">
                <Icon name="terminal" size={16} />
                <h4>Native PTY Streaming</h4>
              </div>
              <p>
                Zero-overhead bidirectional terminal streaming replacing sluggish browser iframes.
                Includes full ANSI colors, interactive keyboard input, and graceful cancellation.
              </p>
            </div>

            <div className="agents-pillar-card">
              <div className="agents-pillar-header">
                <Icon name="shield-check" size={16} />
                <h4>Visual Diffs & Human-in-the-Loop</h4>
              </div>
              <p>
                Review every hunk before changes land. Explicit permission gates for destructive
                shell commands, file rewrites, and network operations.
              </p>
            </div>

            <div className="agents-pillar-card">
              <div className="agents-pillar-header">
                <Icon name="brain" size={16} />
                <h4>Shared Context & Rules</h4>
              </div>
              <p>
                One place for project guidelines. Automatically feeds <code>AGENTS.md</code> and
                custom instructions to whichever agent is executing without duplicate AST indexing.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer note */}
      <footer className="agents-footer">
        <Icon name="info" size={14} />
        <span>
          The legacy OpenCode iframe integration has been retired. Implementation details and progress
          for the native Coding Agents Manager are tracked in{' '}
          <a
            href="https://github.com/Wayn-Git/Amethyst/issues/70"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Issue #70
          </a>
          .
        </span>
      </footer>
    </div>
  )
}
