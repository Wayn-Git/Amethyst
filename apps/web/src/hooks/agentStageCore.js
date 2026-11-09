/**
 * Amethyst Agent Stage State Machine Core
 * Pure state machine handling agent stage detection, synonym rotation,
 * timer pausing, and stall detection.
 */

export const WEB_TOOLS = new Set([
  'web_search',
  'search_web',
  'fetch_web_page',
  'fetch_url',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'image_search',
])

export const PHRASE_POOLS = {
  reasoning: [
    'Thinking',
    'Working on the big things',
    'Crystallizing',
    'Synthesizing',
    'Analyzing context',
    'Considering approaches',
    'Formulating thoughts',
    'Working through logic',
  ],
  searching: [
    'Searching the web',
    'Looking online',
    'Gathering web results',
    'Querying web sources',
    'Finding online info',
    'Fetching web pages',
    'Checking online resources',
    'Retrieving web results',
  ],
  tool: [
    'Calling tools',
    'Running tool',
    'Executing action',
    'Processing request',
    'Working on task',
    'Handling operation',
    'Running subroutine',
    'Performing action',
  ],
  writing_answer: [
    'Writing response',
    'Composing reply',
    'Drafting response',
    'Formatting answer',
    'Structuring reply',
    'Finalizing response',
  ],
  waiting_approval: ['Waiting for your approval'],
  reconnecting: ['Reconnecting to provider...'],
  error: ['Connection interrupted'],
  idle: ['Thought for a moment'],
}

export function classifyTool(toolName) {
  if (!toolName || typeof toolName !== 'string') return 'tool'
  const clean = toolName.toLowerCase().split('__mcp__')[0].trim()
  if (WEB_TOOLS.has(clean)) return 'searching'
  return 'tool'
}

export function computeAgentStage({
  running = false,
  status = null,
  liveTool = null,
  liveReasoning = '',
  liveBuffer = '',
  error = null,
} = {}) {
  if (error) return 'error'

  const state = status?.state || (typeof status === 'string' ? status : '')
  if (state === 'awaiting_approval' || state === 'waiting_approval') {
    return 'waiting_approval'
  }
  if (state === 'reconnecting' || state === 'retrying') {
    return 'reconnecting'
  }

  if (liveTool && liveTool.name) {
    return classifyTool(liveTool.name)
  }

  if (liveBuffer && liveBuffer.trim().length > 0) {
    return 'writing_answer'
  }

  if (liveReasoning && liveReasoning.trim().length > 0) {
    return 'reasoning'
  }

  if (state === 'thinking' || state === 'starting' || state === 'planning') {
    return 'reasoning'
  }

  if (!running && !state) {
    return 'idle'
  }

  return 'reasoning'
}

function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export class StageEngine {
  constructor(nowFn = () => Date.now()) {
    this.now = nowFn
    this.currentStage = 'idle'
    this.currentTool = null
    this.stageEnteredAt = this.now()
    this.lastRotationAt = this.now()
    this.hasRotatedInStage = false
    this.lastEventAt = this.now()
    this.turnStartedAt = this.now()
    this.pausedAccumulatedMs = 0
    this.pauseStartedAt = null

    // Shuffled pool management per stage
    this.phraseIndices = new Map()
    this.shuffledPools = new Map()
    this.currentPhrase = ''

    this.initPools()
  }

  initPools() {
    for (const [stage, pool] of Object.entries(PHRASE_POOLS)) {
      this.shuffledPools.set(stage, shuffle(pool))
      this.phraseIndices.set(stage, 0)
    }
  }

  startTurn(timestamp) {
    const t = timestamp ?? this.now()
    this.turnStartedAt = t
    this.pausedAccumulatedMs = 0
    this.pauseStartedAt = null
    this.lastEventAt = t
    this.initPools()
  }

  setLastEventAt(timestamp) {
    this.lastEventAt = timestamp ?? this.now()
  }

  setStage(stage, tool = null) {
    const now = this.now()
    const toolChanged = (this.currentTool?.name || null) !== (tool?.name || null)

    if (this.currentStage !== stage || toolChanged) {
      // Handle timer pausing for waiting_approval
      if (stage === 'waiting_approval' && !this.pauseStartedAt) {
        this.pauseStartedAt = now
      } else if (stage !== 'waiting_approval' && this.pauseStartedAt) {
        this.pausedAccumulatedMs += (now - this.pauseStartedAt)
        this.pauseStartedAt = null
      }

      this.currentStage = stage
      this.currentTool = tool
      this.stageEnteredAt = now
      this.lastRotationAt = now
      this.hasRotatedInStage = false
      this.currentPhrase = this.pickNextPhrase(stage)
    }
  }

  pickNextPhrase(stage) {
    let pool = this.shuffledPools.get(stage) || PHRASE_POOLS[stage] || ['Thinking']
    let idx = this.phraseIndices.get(stage) || 0

    if (idx >= pool.length) {
      // Re-shuffle avoiding consecutive duplicate at boundary
      const lastPhrase = pool[pool.length - 1]
      let newPool = shuffle(PHRASE_POOLS[stage] || pool)
      if (newPool.length > 1 && newPool[0] === lastPhrase) {
        newPool.push(newPool.shift())
      }
      this.shuffledPools.set(stage, newPool)
      pool = newPool
      idx = 0
    }

    const phrase = pool[idx]
    this.phraseIndices.set(stage, idx + 1)
    return phrase
  }

  rotatePhrase() {
    this.currentPhrase = this.pickNextPhrase(this.currentStage)
    this.lastRotationAt = this.now()
    this.hasRotatedInStage = true
  }

  tick() {
    const now = this.now()

    // Fixed stages never rotate
    if (this.currentStage === 'waiting_approval' ||
        this.currentStage === 'reconnecting' ||
        this.currentStage === 'error' ||
        this.currentStage === 'idle') {
      return
    }

    const timeInStage = now - this.stageEnteredAt
    const timeSinceRotation = now - this.lastRotationAt

    if (!this.hasRotatedInStage) {
      // First rotation after entering stage: occurs at ~3s
      if (timeInStage >= 3000) {
        this.rotatePhrase()
      }
    } else {
      // Subsequent rotations: occur every ~3.5s
      if (timeSinceRotation >= 3500) {
        this.rotatePhrase()
      }
    }
  }

  getElapsedSeconds() {
    const now = this.now()
    const rawElapsed = (this.pauseStartedAt ? this.pauseStartedAt : now) - this.turnStartedAt - this.pausedAccumulatedMs
    return Math.max(0, Math.floor(rawElapsed / 1000))
  }

  shouldShowTimer() {
    return this.getElapsedSeconds() >= 10
  }

  getDisplayLabel() {
    const now = this.now()

    // 1. Static stages
    if (this.currentStage === 'waiting_approval') {
      return PHRASE_POOLS.waiting_approval[0]
    }
    if (this.currentStage === 'reconnecting') {
      return PHRASE_POOLS.reconnecting[0]
    }
    if (this.currentStage === 'error') {
      return PHRASE_POOLS.error[0]
    }

    // 2. Active slow tool execution (> 10s)
    if (this.currentStage === 'tool' || this.currentStage === 'searching') {
      const toolTime = now - this.stageEnteredAt
      if (toolTime >= 10000 && this.currentTool?.name) {
        return `Still running ${this.currentTool.name}`
      }
    }

    // 3. Stall Monitor on Silent Model (reasoning or writing_answer)
    if (this.currentStage === 'reasoning' || this.currentStage === 'writing_answer') {
      const silenceDuration = now - this.lastEventAt
      if (silenceDuration >= 20000) {
        return 'Provider seems slow'
      }
      if (silenceDuration >= 15000) {
        return 'Still working...'
      }
    }

    // 4. Default active phrase
    return this.currentPhrase || PHRASE_POOLS[this.currentStage]?.[0] || 'Thinking'
  }
}
