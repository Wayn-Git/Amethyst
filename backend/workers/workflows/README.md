# Worker repositories

Two GitHub accounts, one workflow file each, and no code of ours in either.

| Account | Repo holds | Runs |
|---|---|---|
| **automation** | `.github/workflows/automation.yml` | what the clock asks for — briefings, sweeps, watched pages |
| **subagent** | `.github/workflows/subagent.yml` | what the agent asks for, in parallel — URL batches, lookups |

The workflow checks out AMETHYST and runs `python -m backend.workers.remote`.
That is deliberate: a collector has one implementation, and it is the one in
`backend/workers/collectors.py`. Copying the collectors into two worker repos
would be the same code in three places, and the first symptom of the drift
would be a briefing that is subtly wrong rather than one that fails.

## Setting one up

1. **Create the repo** on that account. It can be private and empty apart from
   the workflow file.

2. **Copy the workflow** into `.github/workflows/`:

   ```
   cp backend/workers/workflows/subagent.yml  <worker-repo>/.github/workflows/
   ```

3. **Set that repo's Actions secrets** (Settings → Secrets and variables →
   Actions). These belong to the worker and never travel in a dispatch:

   | Secret | What it is |
   |---|---|
   | `AMETHYST_WORKER_TOKEN` | the relay's `WORKER_TOKEN`. Same value in both repos; it can only *write* a report. |
   | `GROQ_API_KEY` *(or another free-tier key)* | optional. Only needed if a task summarises. |
   | `GITHUB_API_TOKEN` | optional. Only for the `github_activity` collector. |

   The only repository **variable** is the optional `AMETHYST_ALLOW_PAID` — set it to `1` to let
   a worker use a metered model. Left unset, a worker will return the collected
   data with no summary rather than spend money nobody approved.

4. **Give AMETHYST a token for that account.** A fine-grained PAT scoped to that
   one repository, with **Actions: read and write** and nothing else:

   ```
   amethyst secrets set amethyst/github-subagent-token
   amethyst secrets set amethyst/github-automation-token
   ```

   Two different tokens on two different accounts. That is the isolation — one
   compromised runner reaching both would make the split cosmetic.

5. **Point AMETHYST at it** — `~/.amethyst/config/workers.yaml`:

   ```yaml
   automation:
     repo: your-automation-account/amethyst-automation
     workflow: automation.yml
     source_repo: you/amethyst      # which AMETHYST the runner checks out
     source_ref: main               # pin to a tag in anger
   subagent:
     repo: your-subagent-account/amethyst-subagents
     workflow: subagent.yml
     source_repo: you/amethyst
     source_ref: main
   relay_url: https://amethyst-relay.<you>.workers.dev
   allow_paid_models: false
   ```

6. **Set the relay's side** of the worker token, once:

   ```
   cd relay && npx wrangler secret put WORKER_TOKEN
   npm run schema        # adds the worker_reports table
   ```

Check it with `POST /api/workers/{account}/check`, which asks GitHub whether the
workflow exists and whether the credential can see it.

## What goes over, and what does not

A dispatch carries a job id, a task name, its parameters, and the relay URL.
That is all. Workflow inputs are visible in the run's own log and to anyone with
read access to that repository, so anything that would mean copying mail or
messages into a run log is marked `local_only` in `backend/workers/collectors.py`
and never leaves this machine — `gmail`, `briefing` and `todo` among them.
`backend/workers/github.py` also refuses outright to dispatch a payload that
looks like it carries a credential.

Results come back through the relay, never through GitHub artifacts or caches.
