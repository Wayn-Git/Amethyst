import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import ServiceIcon from '../components/ServiceIcon.jsx'
import SidePanel from '../components/SidePanel.jsx'
import Markdown from '../components/markdown/Markdown.jsx'
import ConfirmModal from '../components/ConfirmModal.jsx'
import ArtifactPanel from '../components/ArtifactPanel.jsx'
import TurnTrace from '../components/TurnTrace.jsx'
import TurnRail from '../components/TurnRail.jsx'
import { SmoothTextarea, FadeScrollArea } from '../components/ui/skiper/index.js'
import PlusMenu from '../components/PlusMenu.jsx'
import ModelMenu from '../components/ModelMenu.jsx'
import EffortMenu from '../components/EffortMenu.jsx'
import ContextPopover from '../components/ContextPopover.jsx'
import GuardMenu from '../components/GuardMenu.jsx'
import MatrixLoader from '../components/MatrixLoader.jsx'
import { useApp } from '../store.jsx'
import { api, copyText } from '../api.js'
import { useDismiss } from '../hooks/useDismiss.js'
import WidgetRenderer from '../components/widgets/WidgetRenderer.jsx'
import { parseWidgetEnvelope } from '../components/widgets/envelope.js'
import DocumentCardsTray from '../components/DocumentCardsTray.jsx'
import AiProviderIcon from '../components/AiProviderIcon.jsx'
import TerminalDrawer from '../components/TerminalDrawer.jsx'
import { safeStorage } from '../lib/storage.js'
import { MOD_LABEL } from '../keys.js'

/* The composer is the interface. Everything else — which skills are live, which
   connectors it may reach, what it remembers, where it may work — hangs off the
   + menu beside it or the palette above it, so the surface stays one field and
   a sentence. */

/* No provider is special. This used to name one, which made every other
   provider a second-class citizen of the composer's own defaulting. */

/* How long a turn may say nothing at all before this interface stops believing
   in it. Generous on purpose: a single tool call can take minutes and emit
   nothing while it does, and a watchdog that fires on slow work would be worse
   than the hang it replaces. It exists for the case the server can no longer
   report -- a loop wedged on a dead socket, which used to need a page reload. */
const SILENCE_LIMIT_MS = 180_000

// Kept identical to `planning.APPROVAL_MESSAGE` on the server, which is where
// the instruction it answers lives.
const PLAN_APPROVAL = 'Approved. Carry out the plan.'

// Step events belong to the plan being carried out, which is always the most
// recent one on screen -- an older card is a plan that was already finished or
// discarded, and moving its ticks would be a lie about what is running.
function markPlan(items, update) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].kind === 'plan') {
      const next = items.slice()
      next[i] = update(items[i])
      return next
    }
  }
  return items
}


const QUICK_STARTS = [
  {
    id: 'todo',
    icon: 'user',
    accent: 'purple',
    title: 'Write a to-do list',
    subtitle: 'for a personal project or task',
    prompt: 'Write a detailed and structured to-do list for a personal project with priority levels and next action steps.',
  },
  {
    id: 'email',
    icon: 'mail',
    accent: 'amber',
    title: 'Generate an email',
    subtitle: 'to reply to a job offer',
    prompt: 'Generate a polished, professional email replying to a job offer, expressing enthusiasm and asking thoughtful questions about the team and timeline.',
  },
  {
    id: 'summarize',
    icon: 'chat',
    accent: 'teal',
    title: 'Summarize this article',
    subtitle: 'or text for me in one paragraph',
    prompt: 'Summarize the following topic or article in one concise, impactful paragraph covering the core insights.',
  },
  {
    id: 'technical',
    icon: 'code',
    accent: 'blue',
    title: 'How does AI work',
    subtitle: 'in a technical capacity',
    prompt: 'Explain how modern AI and large language models work in a technical capacity, explaining tokens, transformers, weights, and inference.',
  },
]

let idSeq = 0
const nextId = () => `item-${++idSeq}`

function buildRendered(items) {
  const out = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== 'assistant') { out.push(it); continue }
    const toolCalls = (it.callsRaw || []).map((c) => ({
      name: c.function?.name ?? c.name,
      arguments: c.function?.arguments ?? c.arguments,
      status: 'done',
    }))
    let j = i + 1
    while (j < items.length && items[j].kind === 'tool') {
      const t = items[j]
      const slot = toolCalls.find((c) => c.name === t.name && c.content === undefined)
      if (slot) {
        slot.content = t.content
        slot.status = t.isError ? 'error' : 'done'
      } else {
        toolCalls.push({ name: t.name, arguments: t.arguments, content: t.content, status: t.isError ? 'error' : 'done' })
      }
      j++
    }
    out.push({ ...it, toolCalls })
    i = j - 1
  }
  return out
}

/* One trace per turn, not one per step.

   A turn that searches, reads, thinks, searches again and then answers arrives
   from the server as five assistant rows with reasoning between them. Rendered
   one at a time that was ten pieces of machinery stacked between the question
   and the answer -- `Thought for 1s`, `Worked for 1s`, `Thought for 4s`,
   `Worked for 1s` -- which is the build log this was meant to replace, only
   with nicer words on it.

   So a run of machinery folds into a single item: every tool call the turn made
   in order, and how long it spent thinking along the way. The answer follows
   it, once. */
function foldTraces(items) {
  /* `.trim()`, not just falsiness. A turn read back from the database has
     empty text on its tool-calling rows, but the same rows off the live stream
     arrive carrying a newline or two -- whatever the model emitted before it
     called the tool. Testing truthiness split one live turn into a trace per
     step while the identical turn reloaded from history folded into one. */
  /* `tool` as well as an assistant row carrying calls. `buildRendered` folds a
     turn's tool rows onto the assistant row *above* them, which is the shape a
     conversation has when it is read back from the database -- but live, the
     calls arrive with no assistant row between them at all, so they stay
     standalone. Leaving `tool` out of this test is what split one live turn
     into a trace per step while the same turn reloaded folded into one.

     `.trim()` for the same class of reason: a live tool-calling row arrives
     carrying whatever whitespace the model emitted before the call. */
  const isMachinery = (it) => (
    it.kind === 'reasoning'
    || it.kind === 'cost'
    || it.kind === 'tool'
    || (it.kind === 'assistant' && !it.text?.trim() && (it.toolCalls?.length ?? 0) > 0)
  )
  /* A note is not machinery, but it does not end a run of it either. The
     provider-fallback lines -- "groq failed, answering with nvidia instead" --
     land between two tool steps, and treating them as a boundary split one
     turn's trace into four, which is what this fold exists to prevent. They
     come back out above the trace, in order. */
  const isAside = (it) => it.kind === 'note' || it.kind === 'memory'

  let list = items
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    if (!isMachinery(list[i])) { out.push(list[i]); continue }

    /* One ordered list, not a list of thoughts and a list of calls. The turn
       thought, then searched, then thought about what it found, then searched
       again -- and rendering every thought above every call describes a turn
       that planned it all up front, which is not what happened. */
    const events = []
    const asides = []
    /* Asides seen since the last machinery item. They only belong to this run
       once more machinery follows them -- a note *after* the final tool call is
       not inside the run, and emitting it here as well as leaving it for the
       outer loop is what produced two children with the same key. */
    let pending = []
    let ms = 0
    let j = i
    let last = i
    while (j < list.length && (isMachinery(list[j]) || isAside(list[j]))) {
      const it = list[j]
      if (isAside(it)) { pending.push(it); j += 1; continue }
      for (const held of pending) asides.push(held)
      pending = []
      last = j
      if (it.kind === 'reasoning') {
        if (it.text) events.push({ type: 'thought', text: it.text })
        ms += it.ms || 0
      } else if (it.kind === 'cost') {
        // The server's own measurement of the turn, which beats summing the
        // stretches of reasoning we happened to see.
        ms = it.durationMs || ms
      } else if (it.kind === 'tool') {
        events.push({ type: 'tool', call: { name: it.name, arguments: it.arguments, content: it.content, status: it.isError ? 'error' : 'done' } })
      } else {
        for (const c of it.toolCalls) events.push({ type: 'tool', call: c })
      }
      j += 1
    }
    // Trailing asides belong after the trace, not inside the run.
    j = last + 1

    /* The turn's last assistant row usually carries both the final tool calls
       and the text that concludes the turn. Those calls belong to the trace;
       the text does not, so the row stays and only its calls are lifted. */
    const next = list[j]
    if (next && next.kind === 'assistant' && next.text && next.toolCalls?.length) {
      list = list.slice()
      list[j] = { ...next, toolCalls: [] }
      for (const c of next.toolCalls) events.push({ type: 'tool', call: c })
    }

    for (const aside of asides) out.push(aside)
    if (events.length) {
      out.push({ kind: 'trace', id: `trace-${list[i].id}`, events, ms })
    }
    i = j - 1
  }
  return out
}

function historyToItems(rows) {
  return rows.map((m) => {
    // `rowId` is the database id, which is what a pin is written against.
    // Streamed items have none until the transcript is read back, which is why
    // pinning is offered on stored messages and not on one still arriving.
    if (m.role === 'user') {
      return { id: nextId(), rowId: m.id, kind: 'user', text: m.content, pinned: Boolean(m.pinned) }
    }
    if (m.role === 'assistant') {
      // A widget was persisted as a fenced block in its own message, because
      // the message table has no column for one. This is what rebuilds it when
      // the conversation is reopened; `null` for every ordinary answer.
      const widget = parseWidgetEnvelope(m.content ?? '')
      return {
        id: nextId(),
        rowId: m.id,
        kind: 'assistant',
        text: widget ? '' : (m.content ?? ''),
        widget,
        pinned: Boolean(m.pinned),
        callsRaw: Array.isArray(m.tool_calls) ? m.tool_calls : [],
      }
    }
    if (m.role === 'tool') {
      return {
        id: nextId(),
        kind: 'tool',
        name: m.tool_name ?? 'tool',
        arguments: {},
        content: m.content ?? '',
        isError: Boolean(m.is_error),
      }
    }
    return null
  }).filter(Boolean)
}

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      className="msg-copy"
      title={label}
      aria-label={label}
      onClick={async () => {
        setDone(await copyText(text) ? 'ok' : 'no')
        setTimeout(() => setDone(false), 1500)
      }}
    >
      <Icon name={done === 'ok' ? 'check' : done === 'no' ? 'x' : 'copy'} size={13} />
    </button>
  )
}

/* The chain of thought is not the answer, and rendering it as one would be a
   lie about what the model committed to.

   It streams in its own panel while it is happening, because watching it arrive
   is the whole value of having it -- a collapsed block that says "thinking" for
   forty seconds tells you nothing about whether the model is on the right track
   -- and it folds itself away the moment the answer starts, where it stays one
   click from being read again. Opening or closing it by hand wins from then on:
   someone reading the thinking does not want it shutting on them. */
function Reasoning({ text, live, ms }) {
  const [manual, setManual] = useState(null)
  const bodyRef = useRef(null)
  const open = manual === null ? Boolean(live) : manual

  useEffect(() => {
    const el = bodyRef.current
    if (live && el) el.scrollTop = el.scrollHeight
  }, [text, live, open])

  if (!text) return null

  const label = live
    ? 'Thinking'
    : ms
      ? `Thought for ${Math.max(1, Math.round(ms / 1000))}s`
      : 'Thought for a moment'

  return (
    <div className={`reasoning${open ? ' open' : ''}${live ? ' live' : ''}`}>
      <button
        type="button"
        className="reasoning-head"
        onClick={() => setManual(!open)}
        aria-expanded={open}
      >
        <Icon name="chevron" size={11} className="reasoning-caret" />
        <span>{label}</span>
      </button>
      {open && (
        <div className={`reasoning-body${live ? ' is-live' : ''}`} ref={bodyRef}>{text}</div>
      )}
    </div>
  )
}

function PinButton({ item, onPin }) {
  if (!item.rowId) return null
  return (
    <button
      type="button"
      className={`msg-pin${item.pinned ? ' is-pinned' : ''}`}
      title={item.pinned ? 'Unpin' : 'Pin this message'}
      aria-label={item.pinned ? `Unpin ${item.kind} message` : `Pin ${item.kind} message`}
      aria-pressed={item.pinned}
      onClick={() => onPin(item, !item.pinned)}
    >
      <Icon name="pin" size={13} weight={item.pinned ? 'fill' : 'regular'} />
    </button>
  )
}

/* What each named state is called on screen. The set is closed on the server
   (`director.STATUSES`), so a label missing here means a state was added
   without deciding what to call it -- which is why the fallback is the raw
   name rather than a shrug. */
const STATUS_LABELS = {
  starting: 'Starting up',
  retrieving: 'Searching your notes',
  recalling: 'Recalling',
  thinking: 'Thinking',
  planning: 'Planning',
  generating: 'Writing',
  tool: 'Running',
  connector: 'Using',
  retrying: 'Continuing',
  // The stream carrying an answer died and the same provider is being asked to
  // finish the sentence. Named for what the reader sees -- the answer they are
  // already reading, picking up again -- not for the failure behind it.
  resuming: 'Picking up where it stopped',
  switching: 'Switching provider',
  completed: 'Finishing',
  cancelled: 'Stopping',
  failed: 'Failed',
}

function statusLabel(status) {
  if (!status) return 'Thinking'
  const base = STATUS_LABELS[status.state] || status.state
  if (status.state === 'connector' && status.server) return `${base} ${status.server}`
  if (status.state === 'tool' && status.tool) return `${base} ${status.tool}`
  return base
}

function formatDuration(ms) {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

/* The plan, as steps you can act on.

   Plan mode used to prepend a sentence to the message and hope. The steps now
   arrive as a `plan` frame from a `submit_plan` tool call, and nothing that
   changes anything was even offered to the model during the turn that produced
   them -- the registry withheld it. So Approve is the first moment any of this
   could touch the machine. */
/* Where the executing turn has got to. `running` is the step the model said it
   was starting; `done` are the ones it said it finished. Both come from
   `begin_step` calls, never from guessing which tool belongs to which step. */
function stepClass(item, index) {
  const n = index + 1
  if (item.doneSteps?.includes(n)) return 'plan-step--done'
  if (item.runningStep === n) return 'plan-step--running'
  return ''
}

/* What a turn is for. Two modes, not a setting for how hard the model should
   think: wanting a better answer is a reason to pick a better model, which the
   model picker beside this already does. */
const MODES = [
  { id: 'chat', label: 'Chat', hint: 'Answer and act in one turn' },
  { id: 'plan', label: 'Plan', hint: 'Ask for the plan before anything is run' },
]

/* The sentinel for "none of your options". A label rather than a flag because
   it travels through the same pick/cursor machinery as a real option, and a
   second code path for one row is a second code path to keep in step. Chosen to
   be something no model would emit as an option label. */
const OTHER = '\u0000other'

/* The model asking, mid-turn, before it builds the wrong thing.

   One question on screen at a time with "1 of 2" beside it, rather than the
   whole set at once: a wall of questions is a form, and a form gets answered
   carelessly. The free-text row is always last and always present -- the
   options are the model's guesses at what was meant, and being unable to say
   "none of those" would make a wrong guess binding.

   Keyboard-first, because the composer has focus when this appears and making
   someone reach for the mouse to answer one question is the slowest possible
   version of a feature whose whole point is speed. Number keys pick, arrows
   move, Enter advances.

   The turn is suspended while this is open. Answering resumes it with
   everything it had already read still in context, which is why this is a card
   in the transcript and not a new message the user has to compose. */
function QuestionCard({ item, onAnswer, disabled }) {
  const questions = item.questions ?? []
  const [index, setIndex] = useState(0)
  // One entry per question. A multi-select question holds a list; a
  // single-select holds one label or the sentinel for "Something else".
  const [picked, setPicked] = useState(() => questions.map((q) => (q.multi_select ? [] : '')))
  const [other, setOther] = useState(() => questions.map(() => ''))
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef(null)

  const current = questions[index]
  const total = questions.length
  const last = index >= total - 1

  const rows = useMemo(
    () => [...(current?.options ?? []).map((o) => o.label), OTHER],
    [current],
  )

  // Focus follows the question, so the keys below work the moment it appears
  // and again on every step.
  useEffect(() => {
    if (!item.settled) boxRef.current?.focus()
    setCursor(0)
  }, [index, item.settled])

  if (!current) return null

  const multi = Boolean(current.multi_select)
  const choice = picked[index]
  const chose = (label) => (multi ? (choice ?? []).includes(label) : choice === label)
  const wantsOther = multi ? (choice ?? []).includes(OTHER) : choice === OTHER
  const answered = wantsOther
    ? Boolean(other[index].trim()) || (multi && (choice ?? []).length > 1)
    : multi
      ? (choice ?? []).length > 0
      : Boolean(choice)

  const pick = (label) => setPicked((prev) => prev.map((value, i) => {
    if (i !== index) return value
    if (!multi) return label
    const list = value ?? []
    return list.includes(label) ? list.filter((x) => x !== label) : [...list, label]
  }))

  /* What the model reads back. A multi-select answer is joined rather than sent
     as a list because the tool result is prose the model parses by reading, and
     "A, B" says what a JSON array would say with none of the ceremony. */
  const resolve = () => picked.map((value, i) => {
    const written = other[i].trim()
    if (!multi && value === OTHER) return written
    const list = Array.isArray(value) ? value : [value]
    return list.map((x) => (x === OTHER ? written : x)).filter(Boolean).join(', ')
  })

  const advance = () => {
    if (!answered) return
    if (last) settle()
    else setIndex(index + 1)
  }

  const settle = async () => {
    setBusy(true)
    try {
      await onAnswer(item.askId, resolve())
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e) => {
    if (disabled || busy) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setCursor((c) => (c + step + rows.length) % rows.length)
      return
    }
    if (e.key === ' ' || (e.key === 'Enter' && !answered)) {
      e.preventDefault()
      pick(rows[cursor])
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); advance(); return }
    const digit = Number(e.key)
    if (digit >= 1 && digit <= rows.length) { e.preventDefault(); pick(rows[digit - 1]) }
  }

  if (item.settled) {
    return (
      <div className="plan-card question-card is-settled">
        <div className="plan-head">
          <Icon name="check" size={13} />
          <span>Answered</span>
        </div>
        {questions.map((q, i) => (
          <p className="question-recap" key={i}>
            <span className="question-recap-q">{q.header || q.question}</span>
            <span className="question-recap-a">{item.settled[i] || '—'}</span>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div
      className="plan-card question-card"
      ref={boxRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="group"
      aria-label={current.question}
    >
      <div className="plan-head">
        {current.header
          ? <span className="question-chip">{current.header}</span>
          : <><Icon name="info" size={13} /><span>A quick question</span></>}
        {total > 1 && <span className="plan-count">{index + 1} of {total}</span>}
      </div>

      <p className="question-text">{current.question}</p>
      {multi && <p className="question-note">Pick as many as apply.</p>}

      <div className="question-options" role={multi ? 'group' : 'radiogroup'}>
        {rows.map((label, n) => {
          const option = (current.options ?? []).find((o) => o.label === label)
          return (
            <button
              type="button"
              key={label}
              className={`question-option${chose(label) ? ' is-picked' : ''}${cursor === n ? ' is-cursor' : ''}`}
              onClick={() => { setCursor(n); pick(label) }}
              onMouseEnter={() => setCursor(n)}
              disabled={disabled || busy}
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={chose(label)}
            >
              <span className={`question-mark${multi ? ' is-box' : ''}`} aria-hidden="true" />
              <span className="question-option-body">
                <span className="question-option-label">
                  {label === OTHER ? 'Something else' : label}
                </span>
                {option?.description && (
                  <span className="question-option-hint">{option.description}</span>
                )}
              </span>
              <span className="question-key" aria-hidden="true">{n + 1}</span>
            </button>
          )
        })}
      </div>

      {wantsOther && (
        <input
          className="question-other"
          autoFocus
          placeholder="In your own words"
          value={other[index]}
          disabled={disabled || busy}
          onChange={(e) => setOther((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Enter' || !answered) return
            e.preventDefault()
            advance()
          }}
        />
      )}

      <div className="plan-actions">
        {index > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setIndex(index - 1)}
            disabled={disabled || busy}
          >
            Back
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={advance}
          disabled={disabled || busy || !answered}
        >
          {last ? 'Send answer' : 'Next'}
        </button>
        <span className="plan-hint">
          <kbd className="kbd">1</kbd>–<kbd className="kbd">{rows.length}</kbd> to pick,{' '}
          <kbd className="kbd">↵</kbd> to {last ? 'send' : 'continue'}. The turn is waiting.
        </span>
      </div>
    </div>
  )
}

function PlanCard({ item, onApprove, onDiscard, onEditStep, disabled }) {
  return (
    <div className="plan-card">
      <div className="plan-head">
        <Icon name="check" size={14} />
        <span>Plan</span>
        <span className="plan-count">{item.steps.length} steps</span>
      </div>
      {item.summary && <p className="plan-summary">{item.summary}</p>}
      <ol className="plan-steps">
        {item.steps.map((step, i) => (
          <li key={`${item.id}-${i}`} className={stepClass(item, i)}>
            {/* Editable in place. The spec asked for approve, edit or discard,
                and an edited plan travels with the approval -- the model's
                original is already in the transcript, so approving without
                sending the edit would approve the wrong thing. */}
            {item.settled ? (
              <span className="plan-step-title">{step.title}</span>
            ) : (
              <input
                className="plan-step-input"
                value={step.title}
                aria-label={`Step ${i + 1}`}
                onChange={(e) => onEditStep?.(item.id, i, e.target.value)}
              />
            )}
            {step.detail && <span className="plan-step-detail">{step.detail}</span>}
            {step.tools?.length > 0 && (
              <span className="plan-step-tools">{step.tools.join(' · ')}</span>
            )}
          </li>
        ))}
      </ol>
      {item.settled ? (
        <p className="plan-settled">{item.settled === 'approved' ? 'Approved.' : 'Discarded.'}</p>
      ) : (
        <div className="plan-actions">
          <button type="button" className="btn btn--primary btn--small" disabled={disabled} onClick={onApprove}>
            Approve and run
          </button>
          <button type="button" className="btn btn--ghost btn--small" disabled={disabled} onClick={onDiscard}>
            Discard
          </button>
          <span className="plan-hint">Nothing has run yet. Edit the request and plan again to change it.</span>
        </div>
      )}
    </div>
  )
}

const Msg = memo(function Msg({
  item, onPin, onApprovePlan, onDiscardPlan, onEditPlanStep, onAnswerQuestion, busy, onOpenArtifact,
  onResume, setInput, textareaRef,
}) {
  const role = item.kind

  if (role === 'question') {
    return <QuestionCard item={item} onAnswer={onAnswerQuestion} disabled={busy && !item.askId} />
  }
  if (role === 'plan') {
    return (
      <PlanCard
        item={item}
        disabled={busy}
        onApprove={() => onApprovePlan?.(item.id)}
        onDiscard={() => onDiscardPlan?.(item.id)}
        onEditStep={onEditPlanStep}
      />
    )
  }
  if (role === 'cost') {
    return (
      <div className="msg-cost">
        {item.steps} step{item.steps === 1 ? '' : 's'} · {item.tools} tool{item.tools === 1 ? '' : 's'} · {formatDuration(item.durationMs)}
      </div>
    )
  }

  if (role === 'note') {
    const cls = item.tone === 'guard'
      ? 'msg-note--guard'
      : item.tone === 'error' ? 'msg-note--error' : 'msg-note--warning'
    return (
      <div className={`msg-note ${cls}`}>
        <Icon name={item.tone === 'error' ? 'x' : 'info'} size={14} />
        <span>{item.text}</span>
        {/* Half an answer is already above this card, and the model can finish
            it from the transcript -- which is exactly what typing "continue"
            did. One button, in the place the failure is being read. */}
        {item.resumable && (
          <button
            type="button"
            className="btn btn--small msg-note-action"
            disabled={busy}
            onClick={() => onResume?.()}
          >
            Continue the answer
          </button>
        )}
      </div>
    )
  }
  if (role === 'memory') {
    return (
      <div className="msg-note msg-note--warning">
        <Icon name="spark" size={14} />
        <span><strong style={{ fontWeight: 500 }}>remembered</strong> — {item.text}</span>
      </div>
    )
  }
  if (role === 'reasoning') return <Reasoning text={item.text} ms={item.ms} />
  if (role === 'trace') return <TurnTrace events={item.events} ms={item.ms} onOpenArtifact={onOpenArtifact} />
  // A tool call that never got folded into an assistant turn -- a turn that was
  // stopped, or history whose assistant row is missing. Still a line, not a card.
  if (role === 'tool') {
    return <TurnTrace events={[{ type: 'tool', call: { name: item.name, arguments: item.arguments, content: item.content, status: item.isError ? 'error' : 'done' } }]} />
  }
  if (role === 'assistant') {
    // A turn that only called tools has nothing to say yet, and labelling each
    // of those as a reply from AMETHYST turns three steps of one answer into three
    // answers.
    if (!item.text && item.toolCalls?.length) {
      // With the panel open the calls are drawn there, and an assistant turn
      // that only called tools has nothing left to say in the transcript.
      return <TurnTrace events={item.toolCalls.map((call) => ({ type: 'tool', call }))} onOpenArtifact={onOpenArtifact} />
    }
    /* No name over the answer. Two speakers alternating down one column is
       already unambiguous from shape alone -- the question is a bubble against
       the right edge, the answer is prose across the page -- and a label on
       every turn is a word the eye has to step over to reach the sentence it
       came for. The controls come with the hover instead of sitting in the
       reading line permanently. */
    return (
      <div className={`msg msg-assistant${item.pinned ? ' is-pinned' : ''}`}>
        {/* What it did comes before what it says. The work happened first, and
            an answer that arrives under its own working is the order the turn
            actually ran in. */}
        {item.toolCalls?.length > 0 && (
          <TurnTrace
            events={item.toolCalls.map((call) => ({ type: 'tool', call }))}
            ms={item.ms}
            onOpenArtifact={onOpenArtifact}
          />
        )}
        {/* A widget is the answer, not a decoration on one: the turn that
            produced it never generated prose, so there is nothing to render
            alongside. An unknown widget type renders as null, which is why the
            markdown branch stays reachable below. */}
        {item.widget && <div className="msg-body"><WidgetRenderer widget={item.widget} /></div>}
        {!item.widget && item.text && <div className="msg-body"><Markdown text={item.text} /></div>}
        {!item.widget && item.text && (
          <div className="msg-actions">
            <CopyButton text={item.text} label="Copy this answer" />
            <PinButton item={item} onPin={onPin} />
          </div>
        )}
      </div>
    )
  }
  const timeStr = item.created_at || item.timestamp
    ? new Date(item.created_at || item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className={`msg msg-user${item.pinned ? ' is-pinned' : ''}`}>
      <div className="msg-body msg-body--plain">{item.text}</div>
      <div className="msg-user-meta">
        {timeStr && <span className="msg-time">{timeStr}</span>}
        <CopyButton text={item.text} label="Copy" />
        <button
          type="button"
          className="msg-action-btn"
          title="Edit message"
          aria-label="Edit message"
          onClick={() => { setInput(item.text); textareaRef.current?.focus() }}
        >
          <Icon name="edit" size={12} />
        </button>
        <PinButton item={item} onPin={onPin} />
      </div>
    </div>
  )
})

/* What the answer cost to produce.

   Every tool call, every stretch of reasoning and the totals at the end. It
   used to run down the middle of the page between the question and the answer,
   which meant reading a conversation back meant scrolling past the build log
   of one. Here it sits beside the answer instead: still complete, still
   expandable, no longer in the way.

   Rendered through the shared SidePanel into the shell's slot, so the panel
   belongs to the workbench while its contents belong to whichever view is open. */
/* The panel holds documents, and nothing else.

   It used to hold the run: every tool call and stretch of reasoning, moved out
   of the transcript whenever there was room for them. Two things killed that.
   The trace is a folded line in the conversation now, so there is nothing left
   to get out of the way of -- and moving the machinery meant a turn whose whole
   output was a document showed an empty answer and no sign it had done
   anything, because the only record of the write had been filtered out of the
   chat and parked behind a tab. */
function ArtifactSide({
  artifacts, activeArtifact, onSelectArtifact, streamingArtifact, freshArtifact, onClose,
  expanded, onToggleExpand,
}) {
  const active = artifacts.find((a) => a.id === activeArtifact) || artifacts[artifacts.length - 1] || null
  return (
    <SidePanel
      title="Artifacts"
      eyebrow="Chat"
      count={artifacts.length}
      onClose={onClose}
      closeLabel="Hide the artifacts panel"
      footer={
        active && (
          <>
            <span className="mono">{active.language || active.media_type || 'text'}</span>
            {active.version > 1 && <span className="mono">v{active.version}</span>}
          </>
        )
      }
    >
      <ArtifactPanel
        artifacts={artifacts}
        activeId={activeArtifact}
        onSelect={onSelectArtifact}
        streamingId={streamingArtifact}
        freshId={freshArtifact}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
      />
    </SidePanel>
  )
}

export default function Chat() {
  const {
    health, refreshHealth, setView, toast, registerChat,
    conversations, refreshConvs, activeId, setActiveId, setRenaming,
    caps, setCapEnabled, refreshCaps, setCapabilitiesTab,
    workspace, setWorkspace, notify,
    panel, setPanel, compact, view,
    panelExpanded, setPanelExpanded, togglePanelExpanded,
    pendingPrompt, setPendingPrompt,
    defaultGuard, defaultEffort, agentLoader,
    userProfile,
    terminalOpen, toggleTerminal,
  } = useApp()

  const [items, setItems] = useState([])
  // Why the transcript is empty, when it is empty because the fetch failed.
  const [loadError, setLoadError] = useState(null)
  const [turnState, setTurnState] = useState('idle')
  const [stopping, setStopping] = useState(false)
  const [liveTool, setLiveTool] = useState(null)
  const [liveStatus, setLiveStatus] = useState(null)
  const [liveBuffer, setLiveBuffer] = useState('')
  const [liveReasoning, setLiveReasoning] = useState('')
  const [pending, setPending] = useState([])
  const [elsewhere, setElsewhere] = useState([])
  const [input, setInput] = useState('')
  const [activeTag, setActiveTag] = useState(null)
  const [uploadingCount, setUploadingCount] = useState(0)

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    const timeOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const name = userProfile?.name
    return name ? `${timeOfDay}, ${name}` : timeOfDay
  }, [userProfile?.name])

  // A question handed in from the palette or the tray hotkey, waiting for the
  // composer to hold it. See `ask` below for why it cannot just call `send`.
  const [pendingAsk, setPendingAsk] = useState(null)
  /* Documents the agent wrote, keyed by id and in the order they opened. The
     stream has always carried these; nothing was listening. `streamingArtifact`
     is the one currently being written, which is what tells the panel to tail
     the end of the file instead of leaving the scroll where the reader put it. */
  const [artifacts, setArtifacts] = useState([])
  const [activeArtifact, setActiveArtifact] = useState(null)
  const [streamingArtifact, setStreamingArtifact] = useState(null)
  /* Which document this turn produced. Distinct from `streamingArtifact`, which
     is only true between `artifact_open` and `artifact_done` -- today the
     server knows the whole file before it dispatches the tool, so those two
     events land in the same React batch and the flag is false again by the time
     anything is painted. This one stays set until the next turn starts, and it
     is what tells the panel a document is new rather than being browsed. */
  const [freshArtifact, setFreshArtifact] = useState(null)

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt)
      setPendingPrompt(null)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.selectionStart = textareaRef.current.value.length
          textareaRef.current.selectionEnd = textareaRef.current.value.length
        }
      }, 50)
    }
  }, [pendingPrompt, setPendingPrompt])
  const [plusOpen, setPlusOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [draft, setDraft] = useState({ provider: '', model: '' })
  const [acItems, setAcItems] = useState([])
  const [acIndex, setAcIndex] = useState(0)
  const [attachments, setAttachments] = useState([])
  // Plan mode is a real instruction, not a mode flag: it is prepended to the
  // message so the model outlines the work before touching anything.
  /* `chat` answers and acts; `plan` hands back an approvable plan with
     mutating tools withheld. A boolean would do, but the field is what the
     backend takes and a third mode has been added before. */
  const [mode, setMode] = useState('chat')
  const [guard, setGuard] = useState(defaultGuard || 'guard')
  const [effort, setEffort] = useState(defaultEffort || 'high')
  const [variantInfo, setVariantInfo] = useState(null)
  const [modelCaps, setModelCaps] = useState(null)
  const [guardOpen, setGuardOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [lastSent, setLastSent] = useState('')
  const [pinsOpen, setPinsOpen] = useState(true)
  const [queuedMessages, setQueuedMessages] = useState([])
  const [elapsedMs, setElapsedMs] = useState(0)
  const [inspectOpen, setInspectOpen] = useState(false)
  const inspectCardRef = useRef(null)
  const thoughtsStreamRef = useRef(null)

  useDismiss(inspectCardRef, inspectOpen, {
    onAway: () => setInspectOpen(false),
    onEscape: () => setInspectOpen(false),
  })

  useEffect(() => {
    if (turnState !== 'running') setInspectOpen(false)
  }, [turnState])

  useEffect(() => {
    if (inspectOpen && thoughtsStreamRef.current) {
      thoughtsStreamRef.current.scrollTop = thoughtsStreamRef.current.scrollHeight
    }
  }, [inspectOpen, liveReasoning])

  // Live stopwatch timer for running turn
  useEffect(() => {
    if (turnState !== 'running') {
      setElapsedMs(0)
      return
    }
    const start = Date.now()
    setElapsedMs(0)
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - start)
    }, 100)
    return () => clearInterval(timer)
  }, [turnState])
  /* Health banners the user has waved away. Keyed by a signature of what the
     banner says, not just "hidden": a connector that starts failing for a new
     reason, or a different connector going down, is a new fact worth showing
     again. Persisted so a reload does not resurrect one the user already
     dismissed for a condition that has not changed. */
  const [dismissedBanners, setDismissedBanners] = useState(() => {
    try {
      const raw = safeStorage.getItem('amethyst.dismissed.v1')
      return new Set(JSON.parse(raw || '[]'))
    } catch {
      return new Set()
    }
  })
  const dismissBanner = useCallback((sig) => {
    setDismissedBanners((prev) => {
      const next = new Set(prev)
      next.add(sig)
      safeStorage.setItem('amethyst.dismissed.v1', JSON.stringify([...next]))
      return next
    })
  }, [])

  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const fileRef = useRef(null)
  const acTimerRef = useRef(null)
  const liveRef = useRef({ buffer: '', reasoning: '', reasoningStart: 0, tool: null, status: null })
  // One counter per turn. The stream outlives the answer -- memory extraction
  // runs after `done` -- so a turn that has already been superseded must not be
  // allowed to reset the composer when its stream finally closes.
  const turnTokenRef = useRef(0)
  const runningRef = useRef(null)
  const settledRef = useRef(true)

  const providers = health?.providers ?? []
  const defaults = health?.provider_defaults ?? {}
  const active = conversations.find((c) => c.id === activeId)

  // Fetch variant info when the active conversation's model changes (or on initial load).
  useEffect(() => {
    const modelId = active?.model || ''
    if (!modelId) { setVariantInfo(null); return }
    let cancelled = false
    api.getVariant(modelId, activeId).then((info) => {
      if (cancelled) return
      setVariantInfo(info)
      // Set effort to the resolved default (includes session memory)
      setEffort(info.resolved || 'high')
    }).catch(() => { if (!cancelled) setVariantInfo(null) })
    return () => { cancelled = true }
  }, [active?.model, activeId])

  // What to use when nothing has been chosen: the house default if this machine
  // has it configured, otherwise whatever it does have.
  const fallbackProvider = providers[0]
  const draftProvider = draft.provider || fallbackProvider || ''
  const draftModel =
    draft.model || defaults[draftProvider] || ''

  const setBuffer = useCallback((t) => { liveRef.current.buffer = t; setLiveBuffer(t) }, [])
  const setTool = useCallback((t) => { liveRef.current.tool = t; setLiveTool(t) }, [])
  const setStatus = useCallback((next) => { liveRef.current.status = next; setLiveStatus(next) }, [])
  const setReasoning = useCallback((t) => { liveRef.current.reasoning = t; setLiveReasoning(t) }, [])

  /* Loading a transcript has three outcomes, and two of them used to render
     identically. A conversation with no rows and a conversation whose rows
     could not be fetched both ended as `items = []`, which draws the landing
     hero -- so opening either one from the history column looked like the
     click had bounced back to the front page. The error is kept so the
     transcript can say which of the three happened. */
  const loadMessages = useCallback(async (cid) => {
    setLoadError(null)
    if (!cid) { setItems([]); return }
    try {
      const rows = historyToItems(await api.messages(cid))
      /* How the last turn ended, asked of the server rather than remembered.
         A turn whose process was killed wrote nothing here before -- it just
         stopped -- and one that failed with half an answer lost its "Continue
         the answer" button on reload, because the flag only ever existed on the
         terminal frame. The run row is the source of truth for both. */
      const run = await api.runState(cid).catch(() => null)
      if (run?.resumable) {
        rows.push({
          id: nextId(),
          kind: 'note',
          tone: 'error',
          text: run.phase === 'interrupted'
            ? 'This turn stopped when AMETHYST did. The answer above is unfinished.'
            : run.error || 'This turn ended before it finished answering.',
          resumable: true,
        })
      }
      setItems(rows)
    } catch (err) {
      toast(err.message, 'bad')
      setItems([])
      setLoadError(err.message)
    }
  }, [toast])

  /* Artifacts from an earlier session. The stream fills these in as they are
     written, but a conversation reopened tomorrow has to fetch its own -- the
     list is metadata, so the content is read lazily, one document at a time, by
     the effect below. */
  const loadArtifacts = useCallback(async (cid) => {
    if (!cid) { setArtifacts([]); setActiveArtifact(null); return }
    try {
      const rows = await api.artifacts(cid)
      // Newest first from the server; oldest first here, so the panel's order
      // matches the order the conversation produced them in.
      const ordered = [...rows].reverse()
      setArtifacts(ordered)
      setActiveArtifact((id) => (ordered.some((a) => a.id === id) ? id : ordered[ordered.length - 1]?.id ?? null))
    } catch {
      // A conversation with no artifacts and a server that cannot say so look
      // the same from here, and neither is worth a toast over the transcript.
      setArtifacts([])
      setActiveArtifact(null)
    }
  }, [])

  // Content for whichever artifact is on screen, fetched once. `text` is
  // undefined for a row that came from the list and present for one that came
  // off the stream, which is exactly the test for "does this need reading".
  useEffect(() => {
    const row = artifacts.find((a) => a.id === activeArtifact)
    // Fetch if text is undefined (from list) or empty string (from artifact_open
    // before deltas arrived). Skip only if content is already loaded.
    if (!row || (row.text !== undefined && row.text !== '')) return undefined
    let live = true
    api.artifact(row.id)
      .then((full) => {
        if (!live) return
        setArtifacts((prev) => prev.map((a) => (
          a.id === full.id ? { ...a, text: full.content ?? '', missing: full.missing } : a
        )))
      })
      .catch((err) => {
        if (!live) return
        setArtifacts((prev) => prev.map((a) => (
          a.id === row.id ? { ...a, text: '', missing: err.message } : a
        )))
      })
    return () => { live = false }
  }, [activeArtifact, artifacts])

  // A reload lands here with a conversation id from the last session, so the
  // transcript has to be fetched before anything is typed.
  //
  // Never underneath a running turn, though. Sending the first message of a new
  // conversation sets the id, which fires this, which used to race the stream
  // and replace the message that had just been typed with whatever the database
  // had a moment ago -- the "sometimes the prompt does nothing" case.
  useEffect(() => {
    // Only the running turn's *own* conversation is protected from the
    // refetch. Skipping it for any id at all meant that leaving a conversation
    // mid-turn moved the highlight in the sidebar and left the transcript
    // showing the conversation you had just left.
    if (runningRef.current && runningRef.current === activeId) return
    loadMessages(activeId)
    loadArtifacts(activeId)
    refreshCaps(activeId)
  }, [activeId, loadMessages, loadArtifacts, refreshCaps])

  /* Leaving a conversation stops the turn it was running, rather than being
     refused because of it.

     Refusing is what these did, and a refusal that surfaces only as a toast is
     indistinguishable from a dead row in the sidebar -- which is exactly how it
     was reported: "the sidebar doesn't take you to the conversation". A turn
     that has gone quiet holds the refusal for the full three minutes of the
     silence watchdog, so the window for it is not small. Clicking another
     conversation is not an ambiguous gesture: it says stop showing me this one.

     `stop` is defined further down and captured through a ref rather than
     moved, because `notifyDone` lists `selectConversation` in its dependencies
     above where `stop` exists. */
  const stopRef = useRef(null)

  const leaveTurn = useCallback(() => {
    if (turnState === 'idle') return
    stopRef.current?.()
  }, [turnState])

  const selectConversation = useCallback((cid) => {
    if (cid === activeId) return
    leaveTurn()
    setActiveId(cid)
  }, [activeId, leaveTurn, setActiveId])

  const startFresh = useCallback(() => {
    leaveTurn()
    setActiveId(null)
    setItems([])
    setInput('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [leaveTurn, setActiveId])

  const cycleEffort = useCallback(() => {
    if (!variantInfo?.supported?.length) return
    const levels = variantInfo.supported
    const current = effort || 'high'
    const idx = levels.indexOf(current)
    const next = levels[(idx + 1) % levels.length]
    setEffort(next)
    const mid = active?.model || ''
    if (activeId && mid) {
      api.setVariant(mid, next).catch(() => {})
    }
  }, [variantInfo, effort, activeId, active?.model])

  const pushAssistant = useCallback(() => {
    const { buffer, reasoning, reasoningStart } = liveRef.current
    if (reasoning) {
      const ms = reasoningStart ? Date.now() - reasoningStart : 0
      setItems((prev) => [...prev, { id: nextId(), kind: 'reasoning', text: reasoning, ms }])
      setReasoning('')
      liveRef.current.reasoningStart = 0
    }
    if (buffer) {
      setItems((prev) => [...prev, { id: nextId(), kind: 'assistant', text: buffer, callsRaw: [] }])
      setBuffer('')
    }
  }, [setBuffer, setReasoning])

  const pushNote = useCallback((tone, text, extras) => {
    pushAssistant()
    setItems((prev) => [...prev, { id: nextId(), kind: 'note', tone, text: text ?? '', ...extras }])
  }, [pushAssistant])

  /* The stream is closed. Everything it said is already on screen.

     This deliberately does not refetch the transcript. It used to, and the
     refetch is what made every finished turn flicker and then lose its own
     thinking: reasoning, warnings and the memory note are stream-only events
     that were never written to the database, so replacing the local transcript
     with the stored one silently deleted them a second after they appeared. */
  const finish = useCallback(() => {
    settledRef.current = true
    pushAssistant()
    setTurnState('idle')
    setStopping(false)
    setTool(null)
    // `settle` clears this and `done` always goes through `settle` -- but a
    // stream that closes with no terminal frame lands here instead, and used
    // to leave the last status ("Running view_file") behind a finished turn.
    setStatus(null)
    setPending([])
    setElsewhere([])
    refreshConvs()
    // A turn is when connectors reconcile, so the tool count and any connector
    // failure only become knowable once one has run.
    refreshHealth()
    refreshCaps()
  }, [pushAssistant, refreshConvs, refreshHealth, refreshCaps, setTool, setStatus])

  /* `done`, `guard` and `error` end the turn as far as anyone typing is
     concerned, even though the stream stays open behind them: memory extraction
     is a second model call that runs after `done`. Waiting for the stream to
     close before releasing the composer is what put a second "thinking" line
     under a finished answer and left the field disabled for seconds after the
     reply had arrived. */
  const settle = useCallback(() => {
    settledRef.current = true
    pushAssistant()
    setTool(null)
    setStatus(null)
    setTurnState('idle')
    setStopping(false)
    refreshConvs()
  }, [pushAssistant, setTool, setStatus, refreshConvs])

  /* One desktop notification for a finished turn, titled by the conversation it
     belongs to. The store decides whether to actually show it (opted in,
     permission granted, tab in the background) -- here we only say what it says
     and what clicking it does: come back to this conversation. */
  const notifyDone = useCallback((title, body) => {
    const cid = runningRef.current
    const conv = conversations.find((c) => c.id === cid)
    const heading = conv?.title ? `${title} — ${conv.title}` : title
    notify(heading, body || '', () => { if (cid) selectConversation(cid) })
  }, [notify, conversations, selectConversation])

  const onEvent = useCallback((evt) => {
    switch (evt.type) {
      case 'assistant_delta':
        liveRef.current.buffer += evt.text ?? ''
        setBuffer(liveRef.current.buffer)
        break
      case 'reasoning_delta':
        if (!liveRef.current.reasoningStart) liveRef.current.reasoningStart = Date.now()
        liveRef.current.reasoning += evt.text ?? ''
        setReasoning(liveRef.current.reasoning)
        break
      case 'assistant_text':
        setBuffer(evt.text ?? '')
        break
      // The turn answered with UI instead of prose. It streamed no deltas, so
      // there is nothing in the buffer to flush into -- the item is pushed
      // whole, the way a tool result is.
      case 'widget':
        pushAssistant()
        setItems((prev) => [...prev, {
          id: nextId(),
          kind: 'assistant',
          text: '',
          widget: evt.widget,
          callsRaw: [],
        }])
        break
      case 'tool_call':
        pushAssistant()
        setTool({ name: evt.name, arguments: evt.arguments ?? {}, status: 'running' })
        break
      case 'tool_result': {
        const t = liveRef.current.tool
        setItems((prev) => [...prev, {
          id: nextId(),
          kind: 'tool',
          name: t?.name ?? evt.name,
          arguments: t?.arguments ?? {},
          content: evt.content ?? '',
          isError: Boolean(evt.is_error),
        }])
        setTool(null)
        break
      }
      // The model asking before it builds the wrong thing. The turn is
      // suspended on the other end of this, so the card is the only thing that
      // can resume it.
      case 'question_required':
        pushAssistant()
        setItems((prev) => (prev.some((it) => it.askId === evt.id) ? prev : [...prev, {
          id: nextId(),
          kind: 'question',
          askId: evt.id,
          questions: evt.questions ?? [],
          settled: null,
        }]))
        break
      // It stopped waiting -- answered here, answered elsewhere, or timed out.
      // Marked settled either way so a stale card cannot be submitted into a
      // future nothing is holding.
      case 'question_settled':
        setItems((prev) => prev.map((it) => (
          it.askId === evt.id && !it.settled ? { ...it, settled: it.answers ?? [] } : it
        )))
        break
      case 'confirmation_required':
        // The turn is suspended until this is answered. The frame carries the
        // request id, which polling cannot supply unambiguously when two calls
        // to the same tool are pending.
        setPending((p) => (p.some((x) => x.id === evt.request_id) ? p : [...p, {
          id: evt.request_id,
          tool_name: evt.tool_name,
          operation_key: evt.operation_key,
          risk: evt.risk,
          reason: evt.reason,
          arguments: evt.arguments ?? {},
        }]))
        break
      case 'memory': {
        const created = evt.created ?? []
        const superseded = evt.superseded ?? []
        const parts = []
        if (created.length) parts.push(created.join(' · '))
        if (superseded.length) parts.push(`${superseded.length} retired`)
        setItems((prev) => [...prev, { id: nextId(), kind: 'memory', text: parts.join(' — ') }])
        break
      }
      // The plan itself, as data. Rendered as steps with Approve and Discard
      // rather than as prose, which is the whole reason it is a tool call.
      case 'plan':
        pushAssistant()
        setItems((prev) => [...prev, {
          id: nextId(),
          kind: 'plan',
          summary: evt.summary ?? '',
          steps: evt.steps ?? [],
          settled: false,
        }])
        break
      // What the turn is doing right now. Every one of these already happened
      // inside the loop and none of it was visible: the composer said
      // "Thinking" from the moment a turn opened until the first token, whether
      // the wait was retrieval, a cold connector or a provider retry.
      case 'status':
        setStatus(evt.state ? { state: evt.state, tool: evt.tool, server: evt.server } : null)
        break
      // Progress through an approved plan, as the model reported it. Applied to
      // the last plan card, which is the one that was approved.
      case 'step_started':
        setItems((prev) => markPlan(prev, (plan) => ({ ...plan, runningStep: evt.number })))
        break
      case 'step_done':
        setItems((prev) => markPlan(prev, (plan) => ({
          ...plan,
          runningStep: plan.runningStep === evt.number ? null : plan.runningStep,
          doneSteps: [...(plan.doneSteps ?? []), evt.number],
        })))
        break
      case 'done':
        // `execution_logs.duration_ms` has held this since logging shipped and
        // nothing ever read it. Asked immediately or not at all.
        if (evt.duration_ms != null) {
          setItems((prev) => [...prev, {
            id: nextId(),
            kind: 'cost',
            steps: evt.steps ?? evt.iterations ?? 0,
            tools: evt.tools ?? 0,
            durationMs: evt.duration_ms,
          }])
        }
        // If the provider/model changed (fallback), refresh the conversation list
        // so the model picker shows the model that actually answered.
        if (evt.provider && evt.model) {
          refreshConvs()
        }
        // A widget turn's text is the fenced payload it was persisted as, which
        // is not something to read out in a desktop notification.
        notifyDone('Reply ready', parseWidgetEnvelope(evt.text) ? 'An interactive answer is ready.' : evt.text)
        settle()
        break
      case 'guard': pushNote('guard', evt.reason); notifyDone('Turn stopped', evt.reason); settle(); break
      case 'error':
        // `resumable` means half an answer is in the transcript, so the card
        // offers to finish it rather than leaving the reader to type
        // "continue" -- which is what they were doing, several times a session.
        pushNote('error', evt.message, { resumable: Boolean(evt.resumable) })
        notifyDone('Turn failed', evt.message)
        settle()
        break
      // Not terminal: the loop is continuing a turn that came back empty or
      // truncated, and the composer stays disabled while it does.
      case 'warning': pushNote('warning', evt.message); break
      // A keepalive during a long tool call. Nothing to render -- its whole job
      // is done by having arrived: the `beat()` wrapping onEvent has already
      // reset the silence watchdog, and the byte kept the socket alive.
      case 'ping': break

      /* The document, as it is written. `artifact_open` arrives before the
         tool runs, so the panel shows a file that may still be refused at the
         permission gate; `artifact_done` is what says whether it reached the
         disk, and carries the version the row ended up with. */
      case 'artifact_open': {
        const opened = {
          id: evt.id,
          path: evt.path,
          title: evt.title,
          media_type: evt.media_type,
          language: evt.language,
          text: '',
          version: 1,
          bytes: 0,
        }
        setArtifacts((prev) => {
          const at = prev.findIndex((a) => a.id === evt.id)
          // Rewriting the same path is a new version of one artifact, not a
          // second one -- the server decides ids on exactly that basis.
          if (at === -1) return [...prev, opened]
          const next = [...prev]
          /* Metadata is refreshed; text is not thrown away. An open for a
             document that already has content means the same file is being
             announced twice, and `opened.text` is empty -- taking it would
             blank a document mid-read and then refill it from the next delta. */
          next[at] = {
            ...next[at],
            ...opened,
            text: next[at].text ?? opened.text,
            version: next[at].version,
          }
          return next
        })
        setActiveArtifact(evt.id)
        setStreamingArtifact(evt.id)
        setFreshArtifact(evt.id)
        setPanel(true)
        break
      }
      case 'artifact_delta':
        setArtifacts((prev) => prev.map((a) => (
          a.id === evt.id ? { ...a, text: (a.text ?? '') + (evt.text ?? '') } : a
        )))
        break
      case 'artifact_done':
        setArtifacts((prev) => prev.map((a) => (
          a.id === evt.id
            ? {
                ...a,
                bytes: evt.bytes ?? (a.text ?? '').length,
                version: evt.version || a.version,
                error: evt.is_error ? (evt.message || 'the file was not written') : null,
              }
            : a
        )))
        setStreamingArtifact((id) => (id === evt.id ? null : id))
        break

      default:
        /* A frame added on the server used to vanish here without trace, which
           is how you spend an afternoon wondering why the backend's new event
           "does not arrive". It arrives. */
        console.warn('[amethyst] unhandled turn frame', evt.type, evt) // eslint-disable-line no-console
        break
    }
  }, [pushAssistant, pushNote, settle, setBuffer, setReasoning, setTool, setStatus, notifyDone, setPanel])

  const openTurn = useCallback(async (cid, message, mode = 'chat', files = [], opts = {}) => {
    const token = ++turnTokenRef.current
    runningRef.current = cid
    settledRef.current = false
    setItems((prev) => [...prev, { id: nextId(), kind: 'user', text: message }])
    setTurnState('running')
    setAtBottom(true)
    const controller = new AbortController()
    abortRef.current = controller

    /* A wedged stream used to be unrecoverable without reloading the page.
       `reader.read()` has no timeout, so a server-side loop stuck on a dead
       socket left turnState 'running' forever: the composer disabled,
       conversation switching refused, and Stop disabled too once pressed.

       The watchdog is deliberately generous and reset by *every* frame, not
       just text -- a tool call can legitimately take minutes and say nothing
       while it does. It fires only when the connection has gone quiet
       entirely, which is the one case the server can no longer report. */
    let watchdog = null
    const beat = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        if (turnTokenRef.current !== token || settledRef.current) return
        pushNote('error', `No response from the server for ${SILENCE_LIMIT_MS / 1000}s. The turn may still be running; reload to reconnect.`)
        settledRef.current = true
        setTurnState('idle')
        setStopping(false)
        controller.abort()
      }, SILENCE_LIMIT_MS)
    }
    beat()

    try {
      await api.turn({
        conversationId: cid,
        message,
        workspace: workspace.trim() || null,
        mode,
        attachments: files,
        guard: opts.guard,
        effort: opts.effort,
        variant: opts.variant,
        model: opts.model,
        onEvent: (evt) => { beat(); onEvent(evt) },
        signal: controller.signal,
      })
    } catch (err) {
      // An abort after the answer landed is this interface letting go of a
      // stream it no longer needs, not a turn someone interrupted.
      if (err.name === 'AbortError') { if (!settledRef.current) pushNote('warning', 'Stopped.') }
      else pushNote('error', err.message)
      /* Whatever went wrong has now been said once. Without this the `finally`
         below added "The turn ended without a result" underneath it, so a
         single dropped connection printed two red rows that described the same
         event -- and the second one implied a turn that had run and returned
         nothing, which is not what happened. */
      settledRef.current = true
    } finally {
      clearTimeout(watchdog)
      if (turnTokenRef.current === token) {
        /* A clean close with no terminal frame used to push nothing at all:
           the composer re-enabled, the thinking indicator vanished, and if
           nothing had streamed the turn simply evaporated. Silence is not an
           answer, so say so. */
        if (!settledRef.current) {
          pushNote('error', 'The turn ended without a result. Nothing was returned.')
        }
        runningRef.current = null
        finish()
      }
    }
  }, [workspace, onEvent, finish, pushNote])

  // A browser cannot hand the agent a path, so the file is uploaded and the
  // message carries where it landed -- which the ordinary file tools can read.
  const uploadFiles = useCallback(async (files) => {
    setUploadingCount((c) => c + files.length)
    for (const file of files) {
      try {
        const stored = await api.upload(file)
        setAttachments((list) => [...list, stored])
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'bad')
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1))
      }
    }
  }, [toast])

  /* Approve runs the plan as an ordinary chat turn.

     The plan is already in the transcript -- the director persisted it as the
     assistant's own words -- so the executing turn reads it as history rather
     than being handed it again. That is also why approving is a normal turn and
     not a special endpoint: there is nothing special about it except that the
     model has already agreed what it is going to do. */
  const approvePlan = useCallback(async (itemId) => {
    if (turnState !== 'idle' || !activeId) return
    let message = PLAN_APPROVAL
    setItems((prev) => prev.map((it) => {
      if (it.id !== itemId) return it
      if (it.edited) {
        // An edited plan travels with the approval. The model's original is
        // already in the transcript, so approving without sending the edit
        // would approve the plan the user just changed.
        const steps = it.steps.map((st, i) => `${i + 1}. ${st.title}`).join('\n')
        message = `Approved, with this as the plan. Carry it out, and call \`begin_step\` before each step.\n\n${steps}`
      }
      return { ...it, settled: 'approved' }
    }))
    try {
      abortRef.current?.abort()
      await openTurn(activeId, message, 'chat')
    } catch (err) {
      toast(err.message, 'bad')
      setTurnState('idle')
    }
  }, [turnState, activeId, openTurn, toast])

  /* Finish an answer the provider cut in half.

     The transcript already holds the partial and the `[model error]` line
     under it, so this needs nothing the model cannot already read -- it is the
     same ordinary turn the user was typing by hand, minus the typing. */
  const resumeAnswer = useCallback(async () => {
    if (turnState !== 'idle' || !activeId) return
    try {
      abortRef.current?.abort()
      await openTurn(activeId, 'continue', 'chat')
    } catch (err) {
      toast(err.message, 'bad')
      setTurnState('idle')
    }
  }, [turnState, activeId, openTurn, toast])

  const editPlanStep = useCallback((itemId, index, title) => {
    setItems((prev) => prev.map((it) => (
      it.id === itemId
        ? { ...it, steps: it.steps.map((st, i) => (i === index ? { ...st, title } : st)), edited: true }
        : it
    )))
  }, [])

  /* Resume a turn that is suspended on a question.

     Nothing is re-sent: the turn is still open, holding a future, with
     everything it had already read still in its context. That is the whole
     reason this is a card rather than a new message -- answering in the
     composer would end one turn and start another, and the model would have to
     reconstruct what it already knew. */
  const answerQuestion = useCallback(async (askId, answers) => {
    try {
      await api.answerQuestion(askId, answers)
      setItems((prev) => prev.map((it) => (
        it.askId === askId ? { ...it, settled: answers } : it
      )))
    } catch (err) {
      // The commonest failure is a turn that stopped waiting -- it timed out
      // and carried on, or the user pressed Stop. Say so and settle the card,
      // rather than leaving a button that will never work.
      toast(err.message, 'bad')
      setItems((prev) => prev.map((it) => (
        it.askId === askId ? { ...it, settled: answers } : it
      )))
    }
  }, [toast])

  const discardPlan = useCallback((itemId) => {
    // Local only. Nothing ran, so there is nothing to undo on the server, and
    // the plan stays in the transcript because the model said it.
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, settled: 'discarded' } : it)))
  }, [])

  const send = useCallback(async (overrideText, overrideFiles) => {
    const raw = overrideText !== undefined ? overrideText : input
    let typed = (raw || '').trim()
    if (activeTag && activeTag.name && !typed.toLowerCase().includes(`@${activeTag.name.toLowerCase()}`)) {
      typed = `@${activeTag.name} ${typed}`.trim()
    }
    const sending = overrideFiles !== undefined ? overrideFiles : attachments
    if ((!typed && sending.length === 0) || turnState !== 'idle') return
    // A new turn: whatever the last one wrote is no longer new.
    setFreshArtifact(null)
    /* Only the files the model cannot be shown. An image now travels as a
       content block it can actually look at (see `_with_images` in the
       director), so naming its path here as well would invite it to write the
       path down instead of describing the picture -- which is exactly what put
       `/home/wayne/.amethyst/attachments/…/Screenshot.png` into a GitHub issue
       where the screenshot belonged. */
    const unviewable = sending.filter((f) => !String(f.content_type || '').startsWith('image/'))
    const attached = unviewable.length
      ? `\n\nAttached files (read them with view_file):\n${unviewable.map((f) => `- ${f.path}`).join('\n')}`
      : ''

    // Auto-enable mentioned plugins
    if (caps.connectors) {
      const lower = typed.toLowerCase()
      const words = typed.split(/\s+/)
      const mentions = words.filter(w => w.startsWith('@')).map(w => w.slice(1).toLowerCase())
      for (const cap of caps.connectors) {
        const titleClean = (cap.title || cap.name).replace(/\s+/g, '').toLowerCase()
        const nameClean = (cap.name || '').replace(/\s+/g, '').toLowerCase()
        const titleRaw = (cap.title || '').toLowerCase()
        const isMentioned =
          mentions.includes(titleClean) ||
          mentions.includes(nameClean) ||
          (titleClean && lower.includes(`@${titleClean}`)) ||
          (nameClean && lower.includes(`@${nameClean}`)) ||
          (titleRaw && lower.includes(`@${titleRaw}`))
        if (isMentioned && !cap.enabled) {
          try {
            await setCapEnabled(cap, true)
            toast(`Auto-enabled ${cap.title || cap.name}`, 'ok')
          } catch (e) {
            console.error('Failed to auto-enable', cap.name, e)
          }
        }
      }
    }

    const message = `${typed}${attached}`
    if (!message.trim()) return
    if (overrideText === undefined) {
      setInput('')
      setActiveTag(null)
      setAttachments([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    }
    setLastSent(typed)
    setAcItems([])
    let cid = activeId
    try {
      if (!cid) {
        if (!draftProvider) { toast('No provider is configured in providers.yaml', 'bad'); return }
        const { id } = await api.createConversation(
          draftProvider,
          draftModel || '',
          (typed || sending[0]?.name || 'untitled').slice(0, 56),
        )
        cid = id
        setActiveId(id)
        refreshConvs()
      }
      abortRef.current?.abort()
      await openTurn(cid, message, mode, sending, { guard, effort, variant: effort, model: draftModel })
    } catch (err) {
      toast(err.message, 'bad')
      setTurnState('idle')
    }
  }, [
    input, attachments, mode, turnState, activeId, draftProvider, draftModel,
    guard, effort, refreshConvs, openTurn, toast, setActiveId, caps.connectors, setCapEnabled, activeTag,
  ])

  // Queue context/messages while a turn is actively executing (matches Queue ↵ in screenshot)
  const handleQueue = useCallback(() => {
    const typed = input.trim()
    if (!typed && attachments.length === 0) return
    setQueuedMessages((prev) => [...prev, { id: nextId(), text: typed, files: [...attachments] }])
    setInput('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, attachments])

  // Automatically dispatch queued message when the current turn finishes
  useEffect(() => {
    if (turnState === 'idle' && queuedMessages.length > 0) {
      const [next, ...rest] = queuedMessages
      setQueuedMessages(rest)
      const timer = setTimeout(() => {
        send(next.text, next.files)
      }, 80)
      return () => clearTimeout(timer)
    }
  }, [turnState, queuedMessages, send])

  const stop = useCallback(async () => {
    if (!activeId) { abortRef.current?.abort(); return }
    setStopping(true)
    try {
      // The server stops the loop; the stream then ends with a guard frame of
      // its own accord. Aborting the read here would leave it running.
      await api.stopTurn(activeId)
    } catch (err) {
      toast(err.message, 'bad')
      abortRef.current?.abort()
    }
  }, [activeId, toast])

  useEffect(() => { stopRef.current = stop }, [stop])

  const applyModel = useCallback(async (patch) => {
    const caps = patch.capabilities || {}
    if (patch.context_length) caps.context_length = patch.context_length
    setModelCaps(caps)
    
    // Clear old variant info immediately to prevent stale levels showing
    setVariantInfo(null)
    
    // Fetch per-model variant info (saved effort, supported levels, default)
    const modelId = patch.model || ''
    if (modelId && caps.supports_effort !== false) {
      try {
        const info = await api.getVariant(modelId, activeId)
        setVariantInfo(info)
        setEffort(info.resolved || 'high')
      } catch {
        setVariantInfo(null)
      }
    }
    
    // Create db_patch by picking out only provider and model
    const db_patch = { provider: patch.provider, model: patch.model }
    
    if (!activeId) { setDraft((d) => ({ ...d, ...db_patch })) }
    else {
      api.updateConversation(activeId, db_patch).catch((err) => {
        toast(err.message, 'bad')
      })
    }
  }, [activeId, toast])

  /* Ask something without typing it here.

     The palette and the tray's global hotkey both end up here: a question is
     put in the composer and sent as though it had been typed, so there is one
     send path and the turn, the attachments and the plugin mentions all behave
     identically.

     Two steps rather than one because `send` reads `input` from this render --
     calling it in the same tick as `setInput` would send the previous contents.
     Marking it pending instead lets the next render, which has the text, do it. */
  const ask = useCallback((text) => {
    const question = String(text || '').trim()
    if (!question) return
    setInput(question)
    setPendingAsk(question)
  }, [])

  useEffect(() => {
    if (pendingAsk === null) return
    if (turnState !== 'idle') return  // a turn is running; the composer keeps it
    setPendingAsk(null)
    send()
  }, [pendingAsk, turnState, send])

  const focusComposer = useCallback((seed) => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    if (seed) setInput((v) => (v.endsWith(seed) ? v : v + seed))
  }, [])

  /* A pin is a bookmark in a transcript that scrolls. It changes nothing about
     the turn — not what is sent, not what is recalled — which is why it is
     written straight through rather than folded into the turn's state. */
  const onPin = useCallback(async (item, pinned) => {
    if (!activeId || !item.rowId) return
    // Optimistic: the write is one boolean and the row is on screen, so waiting
    // for the round trip only makes the button feel broken.
    setItems((prev) => prev.map((i) => (i.rowId === item.rowId ? { ...i, pinned } : i)))
    try {
      await api.pinMessage(activeId, item.rowId, pinned)
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.rowId === item.rowId ? { ...i, pinned: !pinned } : i)))
      toast(err.message, 'bad')
    }
  }, [activeId, toast])

  const jumpToItem = useCallback((id) => {
    const el = scrollRef.current?.querySelector(`[data-item="${id}"]`)
    if (!el) return
    setAtBottom(false)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-flash')
    setTimeout(() => el.classList.remove('is-flash'), 1200)
  }, [])

  // `⌘P` acts on the newest answer, which is what "pin that" almost always
  // means the moment after reading one.
  const togglePin = useCallback(() => {
    const last = [...items].reverse().find((i) => i.rowId && (i.kind === 'assistant' || i.kind === 'user'))
    if (!last) { toast('Nothing to pin yet', 'info'); return }
    onPin(last, !last.pinned)
    toast(last.pinned ? 'Unpinned' : 'Pinned', 'info')
  }, [items, onPin, toast])
  // What the keyboard layer and the palette drive. Registered as callbacks so
  // neither needs a copy of the turn's state to act on it.
  useEffect(() => {
    registerChat({
      stop,
      startFresh,
      selectConversation,
      focusComposer,
      ask,
      togglePin,
      cycleEffort,
      openPlus: () => setPlusOpen(true),
      attach: () => fileRef.current?.click(),
      beginRename: (cid) => setRenaming(cid),
      turnRunning: turnState === 'running',
    })
  }, [registerChat, stop, startFresh, selectConversation, focusComposer, ask, togglePin, cycleEffort, turnState, setRenaming])

  // Prompts arrive on the stream; this fetch recovers anything a reload left
  // suspended, since the turn survives the page and the stream does not.
  //
  // Pending prompts are process-wide, so they are split by conversation. One
  // belonging to a different conversation must not be raised over the
  // transcript being read here -- answering it would approve a tool call the
  // user cannot see the context for, and it blocks the page until they do.
  const refreshPending = useCallback(async () => {
    try {
      const rows = await api.confirmations()
      setPending(rows.filter((r) => !r.conversation_id || r.conversation_id === activeId))
      setElsewhere(rows.filter((r) => r.conversation_id && r.conversation_id !== activeId))
    } catch {
      /* the prompt still arrives on the stream; this is only the recovery path */
    }
  }, [activeId])

  useEffect(() => {
    // Only between turns: mid-turn the stream is the authority, and a fetch
    // would race it.
    if (turnState === 'idle') refreshPending()
  }, [refreshPending, turnState])

  const runAc = useCallback((value, cid) => {
    const m = value.match(/([/@])([\w-]*)$/)
    if (!m || (m[1] === '/' && m[2].length === 0)) { setAcItems([]); return }
    const prefix = m[1]
    const query = m[2].toLowerCase()

    clearTimeout(acTimerRef.current)
    if (prefix === '/') {
      acTimerRef.current = setTimeout(async () => {
        try {
          const items = await api.skillSearch(query, cid)
          setAcItems(items.slice(0, 6).map(it => ({ ...it, acType: 'skill' })))
          setAcIndex(0)
        } catch { setAcItems([]) }
      }, 160)
    } else if (prefix === '@') {
      const available = caps.connectors || []
      const matches = available.filter((c) => 
        (c.name.toLowerCase().includes(query) || (c.title && c.title.toLowerCase().includes(query)))
      )
      setAcItems(matches.slice(0, 6).map(it => ({ ...it, acType: 'plugin' })))
      setAcIndex(0)
    }
  }, [caps.connectors])

  const acceptAc = useCallback((item) => {
    if (!item) return
    const m = input.match(/([/@])[\w-]*$/)
    const start = m ? m.index : input.length
    if (item.acType === 'skill') {
      setInput(input.slice(0, start) + '/' + item.name + ' ')
    } else {
      setInput(input.slice(0, start) + '@' + (item.title || item.name).replace(/\s+/g, '') + ' ')
    }
    setAcItems([])
    textareaRef.current?.focus()
  }, [input])

  const onDecide = useCallback((id) => setPending((p) => p.filter((x) => x.id !== id)), [])

  /* Turns animate in as they arrive, but a conversation opened from the rail is
     forty of them arriving at once -- which is a page that shudders rather than
     a message that lands. So a freshly loaded transcript is marked settled for
     one frame's worth of paint, and only what comes after it animates. */
  const [settledStream, setSettledStream] = useState(true)
  useEffect(() => {
    setSettledStream(true)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettledStream(false)))
    return () => cancelAnimationFrame(id)
  }, [activeId])

  // Opening a document from the conversation: show the panel, and select the
  // one the card names if it is still on screen.
  const openArtifacts = useCallback((path) => {
    setPanel(true)
    if (path) {
      setArtifacts((prev) => {
        const match = prev.find((a) => a.path === path)
        if (match) setActiveArtifact(match.id)
        return prev
      })
    }
  }, [setPanel])

  const rendered = useMemo(() => buildRendered(items), [items])

  /* What the agent did belongs next to what it said, always.

     Tool calls used to move into the side panel whenever it was open, which
     made sense while they were bordered cards taller than the answer. They are
     a folded line now, so there is nothing to get out of the way of -- and
     moving them had a cost that was never worth it: a turn whose entire output
     was a document got its `create_artifact` call filtered out of the
     transcript and its text left empty, so the conversation showed nothing at
     all. The panel is for the documents themselves now, and only those. */
  const transcript = useMemo(() => foldTraces(rendered), [rendered])



  const pins = useMemo(() => rendered.filter((i) => i.pinned && i.text), [rendered])

  /* Nothing on screen, for one of three reasons.
     The hero -- "What needs doing?" and the openers -- belongs to exactly one
     of them: no conversation is open. An *open* conversation that happens to
     hold no messages is a different fact and has to look different, because
     the two rendered the same before and clicking a row in the history column
     landed on the front page. That is the whole bug: a turn that fails before
     its first write leaves a titled conversation with no rows behind it, and
     opening one of those was indistinguishable from opening nothing. */
  const isBlank = rendered.length === 0 && turnState === 'idle'
  const isEmpty = isBlank && !activeId
  const openedEmpty = isBlank && Boolean(activeId) && !loadError
  /* "Nobody has signed in yet" is not a failure, and the server has said so
     since connectors shipped -- `connectors_awaiting_sign_in` exists for
     exactly this. The banner showed both in the same red sentence, which made
     an ordinary un-signed-in Gmail look like a crash and made a real crash
     look ordinary. Split, and each gets the sentence it deserves. */
  const awaitingSignIn = health?.connectors_awaiting_sign_in ?? []
  const connectorErrors = Object.entries(health?.connector_errors ?? {})
    .filter(([name]) => !awaitingSignIn.includes(name))
  // A banner's signature is its content: dismissing "gmail: refused" hides that
  // exact sentence, and a later "gmail: timed out" is a new one that shows.
  const errorSig = `err:${connectorErrors.map(([n, e]) => `${n}=${e}`).join('|')}`
  const signInSig = `signin:${[...awaitingSignIn].sort().join(',')}`
  const shownModel = (active?.model ?? draftModel ?? '').split('/').pop() || 'Auto'
    // How many connectors are actually switched on for the next message. Rides on
  // the + chip in place of the dock that used to spell the same fact out.
  const liveTools = useMemo(
    () => (caps.connectors ?? []).filter((c) => c.enabled).length,
    [caps.connectors],
  )

  const activeContextCount = useMemo(() => {
    const connCount = (caps.connectors ?? []).filter((c) => c.enabled).length
    const skillCount = (caps.skills ?? []).length
    const attachCount = attachments.length
    return connCount + skillCount + attachCount
  }, [caps.connectors, caps.skills, attachments.length])

  const turnPhase = useMemo(() => {
    if (liveBuffer) return 'writing'
    if (liveTool) return 'executing'
    return 'thinking'
  }, [liveBuffer, liveTool])

  const guardLabel = useMemo(() => {
    if (guard === 'read-only') return 'Read only'
    if (guard === 'guard') return 'Guard'
    if (guard === 'guard-auto-edit') return 'Guard · auto-edit'
    return 'Full access'
  }, [guard])

  const effortLabel = useMemo(() => {
    if (!effort || effort === 'default' || effort === 'high') return 'High'
    if (effort === 'none') return 'None'
    return effort.charAt(0).toUpperCase() + effort.slice(1)
  }, [effort])

  const contextPct = useMemo(() => {
    let charCount = 0
    for (const it of items || []) {
      if (it.text) charCount += it.text.length
      if (it.arguments) charCount += JSON.stringify(it.arguments).length
      if (it.content) charCount += (typeof it.content === 'string' ? it.content.length : JSON.stringify(it.content).length)
      if (it.callsRaw) charCount += JSON.stringify(it.callsRaw).length
    }
    const estimatedTokens = Math.round(charCount / 3.8)
    // Use the selected model's actual context window if available, fallback to 128k
    const windowSize = modelCaps?.context_length || 128000
    const pct = Math.min(100, Math.max(0, Math.round((estimatedTokens / windowSize) * 100)))
    return items.length > 0 ? pct : 0
  }, [items, modelCaps])

  const liveThinkingSnippet = useMemo(() => {
    if (liveReasoning) {
      const lines = liveReasoning.trim().split('\n').filter(Boolean)
      const latest = lines[lines.length - 1] || lines[0]
      return latest.length > 65 ? `${latest.slice(0, 65)}…` : latest
    }
    if (liveStatus) return statusLabel(liveStatus)
    return 'Working through the next step'
  }, [liveReasoning, liveStatus])

  const elapsedSec = (elapsedMs / 1000).toFixed(1)

  // Follow the stream, but never yank the view away from someone reading back.
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !atBottom) return
    el.scrollTo({ top: el.scrollHeight, behavior: turnState === 'running' ? 'auto' : 'smooth' })
  }, [rendered.length, turnState, liveTool, liveBuffer, liveReasoning, atBottom])

  const composer = (
    <div className={`composer-wrap${isEmpty ? ' composer-wrap--hero' : ''}`}>
      {plusOpen && (
        <PlusMenu
          placement={isEmpty ? 'down' : 'up'}
          conversationId={activeId}
          workspace={workspace}
          onWorkspace={setWorkspace}
          onNavigate={setView}
          onAttach={(file) => setAttachments((list) => [...list, file])}
          onClose={() => { setPlusOpen(false); refreshCaps() }}
        />
      )}

      {acItems.length > 0 && (
        <div className="ac-menu">
          {acItems.map((item, i) => (
            <button
              key={item.name}
              type="button"
              className={`ac-item${i === acIndex ? ' active' : ''}`}
              onMouseEnter={() => setAcIndex(i)}
              onClick={() => acceptAc(item)}
            >
              {item.acType === 'plugin' ? (
                 <>
                   <span className="ac-name">
                     <ServiceIcon name={item.name} size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                     @{item.title || item.name}
                   </span>
                   <span className="ac-desc">{item.description}</span>
                 </>
              ) : (
                 <>
                   <span className="ac-name">/{item.name}</span>
                   <span className="ac-desc">{item.description}</span>
                 </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Floating Status Bar & Inspect Card (Screenshots 1, 2, 3) */}
      {turnState === 'running' && (
        <div className="chat-thinking-bar-wrap">
          {/* Elevated Inspect Card (Screenshot 3: anchored above status bar) */}
          {inspectOpen && (
            <div className="turn-inspect-card" ref={inspectCardRef}>
              <div className="inspect-card-header">
                <div className="inspect-model-badge">
                  <Icon name="globe" size={14} />
                  <span className="inspect-model-name">{shownModel}</span>
                  <span className="inspect-effort-pill">{effortLabel.toLowerCase()}</span>
                </div>
              </div>

              <div className="inspect-dashed-divider" />

              <div className="inspect-metrics-table">
                <div className="inspect-metric-row">
                  <span className="inspect-metric-label">Context</span>
                  <span className="inspect-metric-val">{contextPct > 0 ? `${contextPct}%` : 'Not measured yet'}</span>
                </div>
                <div className="inspect-metric-row">
                  <span className="inspect-metric-label">Reasoning</span>
                  <span className="inspect-metric-val">Turn {transcript.filter((t) => t.kind === 'user').length || 1}</span>
                </div>
                <div className="inspect-metric-row">
                  <span className="inspect-metric-label">Tools</span>
                  <span className="inspect-metric-val">{liveTools > 0 ? `${liveTools} active` : 'None yet'}</span>
                </div>
                <div className="inspect-metric-row">
                  <span className="inspect-metric-label">
                    <MatrixLoader phase="thinking" />
                    Completion
                  </span>
                  <span className="inspect-metric-val">{elapsedSec}s</span>
                </div>
              </div>

              {/* Live reasoning stream */}
              {liveReasoning && (
                <>
                  <div className="inspect-dashed-divider" />
                  <div className="inspect-thoughts-stream" ref={thoughtsStreamRef}>
                    <div className="inspect-thoughts-label">
                      <Icon name="brain" size={12} />
                      <span>Live reasoning</span>
                    </div>
                    <div className="inspect-thoughts-text">{liveReasoning}</div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Active Status Bar (Screenshots 1, 2, 3) */}
          <div className="chat-thinking-bar">
            <div className="thinking-bar-left">
              <span className="thinking-grid-icon">
                <MatrixLoader phase={turnPhase} />
              </span>
              <button
                type="button"
                className={`thinking-trigger-btn thinking-trigger-btn--${turnPhase}${inspectOpen ? ' is-open' : ''}`}
                onClick={() => setInspectOpen((o) => !o)}
                title="Toggle thoughts and telemetry"
                aria-expanded={inspectOpen}
              >
                <span>{turnPhase === 'writing' ? 'Writing...' : turnPhase === 'executing' ? 'Executing' : 'Thinking'}</span>
                {turnPhase !== 'writing' && (
                  <Icon name="chevron" size={10} className={`thinking-chevron${inspectOpen ? ' is-open' : ''}`} />
                )}
              </button>
              <span className="thinking-status-text">
                {turnPhase === 'writing' ? (
                  ''
                ) : turnPhase === 'executing' ? (
                  liveTool?.name ? `Running ${liveTool.name}...` : 'Executing tool...'
                ) : (
                  liveThinkingSnippet
                )}
              </span>
            </div>
            <div className="thinking-bar-right">
              <span className="thinking-timer">{elapsedSec}s</span>
              <button
                type="button"
                className="thinking-pause-btn"
                onClick={stop}
                disabled={stopping}
                title="Pause or stop turn"
                aria-label="Pause or stop"
              >
                <span className="thinking-pause-bars">
                  <span />
                  <span />
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queued message indicator if any message was queued while running */}
      {queuedMessages.length > 0 && (
        <div className="composer-queue-preview">
          <span className="queue-badge">{queuedMessages.length} queued</span>
          <span className="queue-text">"{queuedMessages[0].text}"</span>
          <button
            type="button"
            className="queue-cancel-btn"
            onClick={() => setQueuedMessages([])}
            title="Cancel queue"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {/* Clean Composer Card (Image 1 & 2) */}
      <div className={`composer-card${isEmpty ? ' composer-card--hero' : ''}`}>
        <DocumentCardsTray
          attachments={attachments}
          uploadingCount={uploadingCount}
          onRemove={(file) => setAttachments((list) => list.filter((f) => f.path !== file.path))}
        />

        {/* Top Input Row */}
        <div className="composer-card-input-wrap">
          {activeTag && (
            <span className="composer-active-tag">
              {activeTag.type === 'connector' ? (
                <ServiceIcon name={activeTag.name} size={12} />
              ) : (
                <Icon name="spark" size={12} />
              )}
              <span className="composer-active-tag-label">{activeTag.label}</span>
              <button
                type="button"
                className="composer-active-tag-remove"
                onClick={() => setActiveTag(null)}
                aria-label={`Remove ${activeTag.label}`}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}
          <SmoothTextarea
            textareaRef={textareaRef}
            rows={1}
            value={input}
            placeholder={
              turnState === 'running'
                ? 'Add context while this runs'
                : (isEmpty ? 'How can I help you today?' : 'Ask for follow-up changes')
            }
            aria-label="Message"
            onChange={(e) => {
              setInput(e.target.value)
              runAc(e.target.value, activeId)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 260)}px`
            }}
            onPaste={(e) => {
              const files = [...(e.clipboardData?.files || [])]
              if (files.length) { e.preventDefault(); uploadFiles(files) }
            }}
            onKeyDown={(e) => {
              if (acItems.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                setAcIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length)
                return
              }
              if (acItems.length && (e.key === 'Enter' || e.key === 'Tab')) {
                e.preventDefault()
                acceptAc(acItems[acIndex])
                return
              }
              if (acItems.length && e.key === 'Escape') {
                e.stopPropagation()
                setAcItems([])
                if (turnState === 'running') stop()
                return
              }
              if (e.key === 'ArrowUp' && !input && lastSent) {
                e.preventDefault()
                setInput(lastSent)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (turnState === 'running') {
                  handleQueue()
                } else {
                  send()
                }
              }
            }}
          />
        </div>

        {/* Bottom Tools & Actions Row (Matching Image 1) */}
        <div className="composer-card-bottom-bar">
          <div className="composer-card-tools-left">
            <button
              type="button"
              className={`composer-tool-btn${plusOpen ? ' is-active' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { setPlusOpen((o) => !o); setModelOpen(false); setGuardOpen(false); setEffortOpen(false); setContextOpen(false) }}
              title={`Files, skills, connectors — ${MOD_LABEL}+/`}
              aria-label="Add attachments or context"
            >
              <Icon name="plus" size={16} />
              {attachments.length > 0 && <span className="composer-tool-count">{attachments.length}</span>}
            </button>

            <button
              type="button"
              className="composer-tool-btn"
              onClick={() => fileRef.current?.click()}
              title="Attach documents or data"
              aria-label="Attach documents"
            >
              <Icon name="paperclip" size={16} />
            </button>

            <button
              type="button"
              className="composer-tool-btn"
              onClick={() => {
                setInput((prev) => (prev ? `${prev} /search ` : '/search '))
                textareaRef.current?.focus()
              }}
              title="Web search & live internet research"
              aria-label="Web search"
            >
              <Icon name="globe" size={16} />
            </button>

            <button
              type="button"
              className={`composer-tool-btn${terminalOpen ? ' is-active' : ''}`}
              onClick={toggleTerminal}
              title="Interactive Terminal"
              aria-label="Toggle terminal"
            >
              <Icon name="term" size={16} />
            </button>
          </div>

          <div className="composer-card-tools-right">
            {/* Model selector pill (Image 4) with real model/provider logo */}
            <div className="composer-model-pill-wrap">
              <button
                type="button"
                className="composer-model-pill"
                onClick={() => { setModelOpen((o) => !o); setPlusOpen(false); setGuardOpen(false); setEffortOpen(false); setContextOpen(false) }}
                title="Provider and model"
              >
                <AiProviderIcon
                  provider={active?.provider ?? draftProvider}
                  model={active?.model ?? draftModel}
                  size={14}
                  className="composer-model-provider-icon"
                />
                <span className="composer-model-name">{shownModel}</span>
                <Icon name="chevron" size={9} className="composer-model-chevron" />
              </button>
              {modelOpen && (
                <ModelMenu
                  placement={isEmpty ? 'down' : 'up'}
                  provider={active?.provider ?? draftProvider}
                  model={active?.model ?? draftModel}
                  scoped={Boolean(activeId)}
                  onChange={applyModel}
                  onClose={() => setModelOpen(false)}
                />
              )}
            </div>

            {/* Send / Stop button */}
            {turnState === 'running' ? (
              <>
                <button
                  type="button"
                  className="composer-send-circle is-stop"
                  onClick={stop}
                  disabled={stopping}
                  title="Stop turn — Esc"
                  aria-label="Stop"
                >
                  <span className="composer-stop-square" />
                </button>
                <button
                  type="button"
                  className="composer-queue-btn"
                  onClick={handleQueue}
                  title="Queue message to run after current turn — Enter"
                  aria-label="Queue"
                >
                  <span>Queue</span>
                  <span className="composer-queue-symbol">↵</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="composer-send-circle"
                onClick={() => send()}
                disabled={!input.trim() && attachments.length === 0}
                title="Send — Enter"
                aria-label="Send"
              >
                <Icon name="arrow-up" size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Controls Bar (Only in active conversations) */}
      {!isEmpty && (
        <div className="composer-footer-bar">
          {/* Left Cluster */}
          <div className="composer-footer-left">
            {/* Workspace chip */}
            <button
              type="button"
              className="composer-footer-chip composer-footer-chip--workspace"
              onPointerDown={(e) => e.stopPropagation()} onClick={() => { setPlusOpen(true); setGuardOpen(false); setEffortOpen(false); setModelOpen(false); setContextOpen(false) }}
              title="Workspace folder"
            >
              <Icon name="folder" size={13} />
              <span>{workspace ? (workspace.charAt(0).toUpperCase() + workspace.slice(1)) : 'Amethyst'}</span>
            </button>

            {/* Guard mode chip */}
            <div className="composer-footer-chip-wrap">
              <button
                type="button"
                className={`composer-footer-chip composer-footer-chip--guard${guard === 'full-access' || guard === 'full' ? ' is-full-access' : ''}${guardOpen ? ' is-active' : ''}`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => { setGuardOpen((o) => !o); setEffortOpen(false); setModelOpen(false); setPlusOpen(false); setContextOpen(false) }}
                title="Guard mode"
              >
                <Icon name={guard === 'full-access' || guard === 'full' ? 'shield-check' : 'shield'} size={13} className="guard-status-icon" />
                <span>{guard === 'guard' ? 'Guard' : guardLabel}</span>
                <Icon name="chevron" size={10} className="composer-footer-chevron" />
              </button>
              {guardOpen && (
                <GuardMenu
                  guard={guard}
                  onChange={setGuard}
                  onClose={() => setGuardOpen(false)}
                  placement="up"
                />
              )}
            </div>

            {/* Reasoning effort chip */}
            <div className="composer-footer-chip-wrap">
              <button
                type="button"
                className={`composer-footer-chip composer-footer-chip--effort${effortOpen ? ' is-active' : ''}`}
                style={{ opacity: (modelCaps && modelCaps.supports_effort === false) ? 0.5 : 1, cursor: (modelCaps && modelCaps.supports_effort === false) ? 'not-allowed' : 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (modelCaps && modelCaps.supports_effort === false) return;
                }}
                onClick={(e) => {
                  if (modelCaps && modelCaps.supports_effort === false) {
                    e.preventDefault();
                    return;
                  }
                  setEffortOpen((o) => !o); setGuardOpen(false); setModelOpen(false); setPlusOpen(false); setContextOpen(false) 
                }}
                title={(modelCaps && modelCaps.supports_effort === false) ? "This model does not support reasoning effort" : "Reasoning effort (mod+shift+m to cycle)"}
              >
                <Icon name="lightning" size={13} className="effort-lightning-icon" />
                <span>{(modelCaps && modelCaps.supports_effort === false) ? "None" : effortLabel}</span>
                {(!modelCaps || modelCaps.supports_effort !== false) && <Icon name="chevron" size={10} className="composer-footer-chevron" />}
              </button>
              {effortOpen && (!modelCaps || modelCaps.supports_effort !== false) && (
                <EffortMenu
                  effort={effort}
                  levels={variantInfo?.supported || modelCaps?.effort_levels}
                  onChange={(e) => {
                    setEffort(e)
                    const modelId = draftModel || ''
                    if (modelId) api.setVariant(modelId, e).catch(() => {})
                  }}
                  onClose={() => setEffortOpen(false)}
                  placement="up"
                />
              )}
            </div>
          </div>

          {/* Right Cluster */}
          <div className="composer-footer-right">
            {/* Context ring meter */}
            <div className="composer-footer-chip-wrap">
              <button
                type="button"
                className={`composer-footer-context${contextOpen ? ' is-active' : ''}`}
                title={`Context memory usage: ${contextPct}%`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => { setContextOpen((o) => !o); setGuardOpen(false); setEffortOpen(false); setModelOpen(false); setPlusOpen(false) }}
              >
                <svg className="context-donut-svg" width="13" height="13" viewBox="0 0 36 36">
                  <path
                    className="context-donut-track"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="context-donut-fill"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={`${Math.max(contextPct, 1)}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <span>Context {contextPct}%</span>
              </button>
              {contextOpen && (
                <ContextPopover
                  pct={contextPct}
                  usedTokens={items.length * 150}
                  maxTokens={128000}
                  compactionTokens={90000}
                  onClose={() => setContextOpen(false)}
                  placement="up"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="view view--flush">
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = '' }}
      />

      <div className="chat-main">
        {!isEmpty && elsewhere.length > 0 && (
          <div className="chat-banner msg-note msg-note--guard">
            <Icon name="key" size={14} />
            <span>
              {elsewhere.length === 1
                ? 'A tool call in another conversation is waiting for an answer.'
                : `${elsewhere.length} tool calls in other conversations are waiting for an answer.`}
              {' '}That turn stays suspended until it is answered.
            </span>
            <button
              type="button"
              className="btn btn--small"
              style={{ marginLeft: 'auto' }}
              onClick={() => selectConversation(elsewhere[0].conversation_id)}
            >
              Open it
            </button>
          </div>
        )}

        {!isEmpty && connectorErrors.length > 0 && !dismissedBanners.has(errorSig) && (
          <div className="chat-banner msg-note msg-note--error">
            <Icon name="plug" size={14} />
            <span>
              {connectorErrors.map(([name, err]) => `${name}: ${String(err).slice(0, 90)}`).join(' · ')}
              {' '}— its tools are not reaching the agent.
            </span>
            <button
              type="button"
              className="btn btn--small"
              style={{ marginLeft: 'auto' }}
              onClick={() => { setCapabilitiesTab('connectors'); setView('capabilities') }}
            >
              Open connectors
            </button>
            <button
              type="button"
              className="chat-banner-dismiss"
              title="Dismiss until this changes"
              aria-label="Dismiss"
              onClick={() => dismissBanner(errorSig)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        {!isEmpty && awaitingSignIn.length > 0 && !dismissedBanners.has(signInSig) && (
          <div className="chat-banner msg-note msg-note--guard">
            <Icon name="key" size={14} />
            <span>
              {awaitingSignIn.length === 1
                ? `${awaitingSignIn[0]} is switched on but not signed in.`
                : `${awaitingSignIn.join(', ')} are switched on but not signed in.`}
              {' '}Their tools stay out of reach until they are.
            </span>
            <button
              type="button"
              className="btn btn--small"
              style={{ marginLeft: 'auto' }}
              onClick={() => { setCapabilitiesTab('connectors'); setView('capabilities') }}
            >
              Sign in
            </button>
            <button
              type="button"
              className="chat-banner-dismiss"
              title="Dismiss until this changes"
              aria-label="Dismiss"
              onClick={() => dismissBanner(signInSig)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        {isEmpty ? (
          <div className="hero-stack">
            {/* Amethyst Crystal Logo (without background chip/orb) */}
            <div className="hero-logo-wrap">
              <svg
                viewBox="524.5 524 560 560"
                className="hero-logo-mark"
                width="54"
                height="54"
                aria-label="Amethyst Logo"
              >
                <path fill="var(--accent, #873FFF)" d="M804 536L684 651L791 1015L768 1018L644 888L572 889L806 1072L1038 887L968 887L843 1018L819 1015L927 651Z"/>
                <path fill="var(--accent, #873FFF)" d="M1016 701L928 722L847 986L960 870L1039 846Z"/>
                <path fill="var(--accent, #873FFF)" d="M595 701L570 845L651 870L763 985L682 722Z"/>
              </svg>
            </div>

            {/* Dynamic Greeting & Subtitle (Image 4) */}
            <div className="hero">
              <h1 className="hero-headline">{greeting}</h1>
              <p className="hero-subheadline">
                What's on <span className="hero-gradient-text">your mind?</span>
              </p>
            </div>

            {/* Composer Card */}
            {composer}

            {/* Quick starts. Chips rather than cards: they are a shortcut into
                the composer, not four things to read before you can type. */}
            <div className="hero-chips">
              {QUICK_STARTS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="hero-chip"
                  title={card.subtitle}
                  onClick={() => {
                    setInput(card.prompt)
                    textareaRef.current?.focus()
                  }}
                >
                  <Icon name={card.icon} size={14} />
                  <span>{card.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {pins.length > 0 && (
              <div className={`pin-strip${pinsOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className="pin-strip-head"
                  onClick={() => setPinsOpen((o) => !o)}
                  aria-expanded={pinsOpen}
                >
                  <Icon name="pin" size={12} weight="fill" />
                  <span>{pins.length} pinned</span>
                  <Icon name="chevron" size={11} className="pin-strip-caret" />
                </button>
                {pinsOpen && (
                  <div className="pin-strip-list">
                    {pins.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="pin-chip"
                        onClick={() => jumpToItem(item.id)}
                        title={item.text}
                      >
                        <span className="pin-chip-who">{item.kind === 'user' ? 'you' : 'amethyst'}</span>
                        <span className="pin-chip-text">{item.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="pin-chip-off"
                          aria-label="Unpin"
                          onClick={(e) => { e.stopPropagation(); onPin(item, false) }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onPin(item, false) } }}
                        >
                          <Icon name="x" size={11} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* The transcript fades at whichever edge it actually runs past,
                so a reply that continues above the fold says so without a rule
                across the page. */}
            <FadeScrollArea className="chat-scroll" scrollRef={scrollRef} onScroll={onScroll} fadeHeight={28}>
              <div className={`chat-stream${settledStream ? ' is-settled' : ''}`}>
                {loadError && (
                  <div className="chat-note chat-note--bad" role="status">
                    <Icon name="alert" size={14} />
                    <span>This conversation&rsquo;s messages could not be loaded. {loadError}</span>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => loadMessages(activeId)}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {openedEmpty && (
                  <div className="chat-note" role="status">
                    <Icon name="chat" size={14} />
                    <span>
                      <strong>{active?.title || 'This conversation'}</strong> has no messages yet.
                      {' '}Its first turn never reached the transcript — ask again below.
                    </span>
                  </div>
                )}
                {transcript.map((item) => (
                  <div key={item.id} data-item={item.id} className="stream-item">
                    <Msg
                      item={item}
                      onOpenArtifact={openArtifacts}
                      onPin={onPin}
                      busy={turnState !== 'idle'}
                      onApprovePlan={approvePlan}
                      onAnswerQuestion={answerQuestion}
                      onDiscardPlan={discardPlan}
                      onEditPlanStep={editPlanStep}
                      onResume={resumeAnswer}
                      setInput={setInput}
                      textareaRef={textareaRef}
                    />
                  </div>
                ))}
                {turnState === 'running' && (liveTool || liveBuffer) && (
                  <div className="msg msg-assistant is-live">
                    {liveTool && (
                      <TurnTrace
                        events={[]}
                        live={liveTool}
                        running
                      />
                    )}
                    {liveBuffer && (
                      <div className="msg-body">
                        <Markdown text={liveBuffer} />
                        <span className="tele-cursor" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </FadeScrollArea>
            {/* The map of the conversation, down the right edge. */}
            <TurnRail
              items={transcript}
              scrollRef={scrollRef}
              onJump={(id) => {
                const el = scrollRef.current?.querySelector(`[data-item="${id}"]`)
                // The rail is a deliberate move away from the bottom, so it also
                // switches the stream off follow -- otherwise the next token
                // yanks the view straight back.
                setAtBottom(false)
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />

            {!atBottom && (
              <button
                type="button"
                className="jump-latest"
                onClick={() => { setAtBottom(true); const el = scrollRef.current; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }}
              >
                <Icon name="down" size={13} /> latest
              </button>
            )}
            {composer}
          </>
        )}
        <TerminalDrawer />
      </div>

      {panel && !compact && view === 'chat' && (
        <ArtifactSide
          artifacts={artifacts}
          activeArtifact={activeArtifact}
          onSelectArtifact={setActiveArtifact}
          streamingArtifact={streamingArtifact}
          freshArtifact={freshArtifact}
          expanded={panelExpanded}
          onToggleExpand={togglePanelExpanded}
          onClose={() => { setPanelExpanded(false); setPanel(false) }}
        />
      )}

      <ConfirmModal pending={pending} onDecide={onDecide} />
    </div>
  )
}
