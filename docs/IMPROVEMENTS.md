# Parallel Jobs & System Improvements

This document covers the major system improvements made to Amethyst, including
parallel execution, smart file reading, and LLM intelligence rules.

## Table of Contents

- [Parallel Execution](#parallel-execution)
- [Smart File Reading](#smart-file-reading)
- [LLM Intelligence Rules](#llm-intelligence-rules)
- [Troubleshooting](#troubleshooting)

---

## Parallel Execution

### What is it?

Parallel execution lets Amethyst run multiple data-gathering tasks
simultaneously instead of one after another. This dramatically speeds up
research and data collection tasks.

### How it works

```python
# Instead of this (slow):
result1 = web_search("AI news")      # 3 seconds
result2 = web_search("climate")      # 3 seconds
result3 = fetch_url("https://...")   # 2 seconds
# Total: 8 seconds

# Do this (fast):
dispatch_parallel_jobs([
  {task: "web_search", params: {query: "AI news"}},
  {task: "web_search", params: {query: "climate"}},
  {task: "urls", params: {urls: ["https://..."]}},
])
# Total: ~3 seconds (all run at once)
```

### Available Tasks

| Task | Description | Example Params |
|------|-------------|----------------|
| `urls` | Read web pages | `{urls: ["url1", "url2"]}` |
| `web_search` | Search the web | `{query: "search term"}` |
| `gmail` | Read email | `{max_results: 10}` |
| `github_activity` | GitHub events | `{username: "user"}` |
| `git_status` | Git repository status | `{path: "."}` |
| `file_info` | File metadata | `{paths: ["file1.py"]}` |
| `system_info` | System information | `{}` |
| `briefing` | Calendar/tasks/mail | `{period: "day"}` |
| `todo` | Task management | `{action: "list"}` |
| `rss` | RSS feeds | `{feeds: ["feed1"]}` |

### Task Name Auto-Correction

The system automatically corrects common task name mistakes:

| You type | Corrected to |
|----------|--------------|
| `fetch_url`, `fetch`, `scrape` | `urls` |
| `search`, `google`, `lookup` | `web_search` |
| `git`, `repo`, `repository` | `git_status` |
| `system`, `cpu`, `disk` | `system_info` |
| `mail`, `email`, `inbox` | `gmail` |
| `calendar`, `schedule` | `briefing` |
| `tasks` | `todo` |

### Error Handling

If you use a wrong task name, you'll get a clear error:

```
Task 'invalid_task' not found. Available tasks:
- briefing: Tasks, calendar, mail and library for a day or a week.
- file_info: Get file metadata (size, type, modified) without reading contents.
- git_status: Get git status: changed files, branch, dirty state.
...
```

### Progress Tracking

While jobs are running, you can see real-time progress in the UI:
- Each job shows its status (pending, running, ok, failed)
- Progress bar shows completion percentage
- Summary shows total time and success rate

---

## Smart File Reading

### Hard Limits

To prevent token explosion and improve performance, file reads have hard limits:

- **Maximum file size:** 50KB (was 400KB)
- **Maximum lines:** 2,000
- **Maximum line length:** 2,000 characters

### Binary File Detection

Amethyst automatically detects binary files:
- Checks file extension (ZIP, EXE, PDF, images, etc.)
- Detects null bytes
- Checks non-printable character ratio (>30% = binary)

Binary files cannot be read as text. You'll get a clear error message.

### Image Detection

Images are automatically detected and handled:
- **PNG, JPEG, GIF, WEBP** — Detected by header bytes
- Returns base64-encoded image data
- Shows MIME type and file size

### Pagination

For large files, use pagination:

```python
# Read lines 100-150 of a large file
view_file("large_file.py", offset=100, limit=50)
```

### Truncation Notices

When data is truncated, you'll see clear notices:

```
1    import os
2    import sys
3    # ... more lines ...

[showing lines 1-50 of 2000; file has 5,432 lines]
```

---

## LLM Intelligence Rules

The agent follows strict rules to prevent common mistakes:

### Rule 1: Never Guess Tool Names

**BEFORE using any tool, you MUST:**
1. Check if the tool name exists in your available tools
2. Use ONLY the exact tool names listed
3. NEVER invent tool names

**Example of WRONG behavior:**
```
# User asks: "Search for AI news"
I call: tavily__tavily_search  ← TOOL DOESN'T EXIST
I call: web_search__mcp__tavily  ← TOOL DOESN'T EXIST
```

**Example of RIGHT behavior:**
```
# User asks: "Search for AI news"
I check: What tools do I have?
I see: web_search, fetch_url, grep_files, etc.
I call: web_search  ← CORRECT, exists in my tools
```

### Rule 2: Never Retry Failed Tools

**When a tool fails:**
1. Read the error message carefully
2. Understand WHY it failed
3. Fix the root cause before retrying
4. NEVER retry the exact same call that just failed

**Example of WRONG behavior:**
```
dispatch_parallel_jobs → KeyError
dispatch_parallel_jobs → KeyError (SAME ERROR - WASTED TURN)
```

**Example of RIGHT behavior:**
```
dispatch_parallel_jobs → KeyError
→ Read error: "task 'fetch_url' not found"
→ Check available tasks: urls, web_search, etc.
→ Retry with correct task name: urls
```

### Rule 3: Never Generate Fake Data

**When you can't get real data:**
1. Tell the user honestly: "I couldn't retrieve the data because [reason]"
2. List what you tried and what failed
3. Suggest alternatives the user can try
4. NEVER make up "representative", "estimated", or "sample" data

**Example of WRONG behavior:**
```
"Here's the stock data for 2022-2026:"
[Generated fake numbers that look real]
```

**Example of RIGHT behavior:**
```
"I couldn't retrieve the stock data because:
- Yahoo Finance returned 403 (blocked)
- Macrotrends returned truncated data
- No other data sources available

Would you like me to:
1. Try alternative sources (Google Finance, MarketWatch)?
2. Use a different time range?
3. Show you how to get the data manually?"
```

### Rule 4: Always Have Fallback Strategy

**Research fallback order:**
1. Primary source (e.g., Yahoo Finance)
2. Alternative source (e.g., Google Finance, MarketWatch)
3. Aggregator (e.g., Bloomberg, Reuters)
4. Direct data endpoint (CSV/API)
5. Manual instruction to user

### Rule 5: Tool Inspection Protocol

**Before ANY tool call, you MUST:**
1. Check if the tool name exists in your available tools
2. Check if you have the required parameters
3. Check if you're using the correct parameter names
4. If unsure, use `list_files` or check the tool schemas

---

## Troubleshooting

### "Task not found" error

**Problem:** You get an error saying a task doesn't exist.

**Solution:** Check the available tasks list and use the correct name.
Common corrections:
- `fetch_url` → `urls`
- `search` → `web_search`
- `git` → `git_status`

### File too large error

**Problem:** You get an error saying a file is too large.

**Solution:** Use pagination or grep to search within the file:
```python
# Option 1: Paginate
view_file("large_file.py", offset=0, limit=100)

# Option 2: Search
grep_files("pattern", path="large_file.py")
```

### Binary file error

**Problem:** You get an error saying a file is binary.

**Solution:** Binary files cannot be read as text. Use the appropriate
tool for the file type (e.g., image viewer for images).

### Parallel jobs not completing

**Problem:** Parallel jobs seem to hang or not complete.

**Solution:** Check the job status and collect results:
```python
# Check status
collect_jobs(batch_id="abc123")

# Wait for completion
collect_jobs(batch_id="abc123", wait_seconds=30)
```

### Agent generating fake data

**Problem:** The agent is making up data instead of getting real data.

**Solution:** This violates Rule 3. The agent should:
1. Tell you honestly what happened
2. List what it tried
3. Suggest alternatives

If you see this, the agent is not following the rules. Report it as a bug.

---

## Performance Tips

1. **Use parallel execution** for 3+ independent tasks
2. **Use pagination** for large files
3. **Use grep** instead of reading entire files
4. **Let the agent collect results later** instead of waiting

## Further Reading

- [README.md](../README.md) — Project overview
- [QUICKSTART.md](../QUICKSTART.md) — Getting started guide
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Development guidelines
