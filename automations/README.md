# Cloud Automations

This folder contains cloud-only automation definitions intended to run in GitHub Actions without needing a 24/7 running PC or hosted server.

## Schema

Each file is a JSON document representing an automation:

```json
{
  "name": "unique_automation_name",
  "description": "Short description of what this automation does",
  "schedule": "0 8 * * *",
  "provider": "auto",
  "model": null,
  "prompt": "The prompt to send to the Amethyst agent turn",
  "actions": [
    "search_web",
    "send_mail"
  ]
}
```

### Fields

* **`name`** *(string, required)*: Identifier for the automation.
* **`description`** *(string, optional)*: Human-readable description.
* **`schedule`** *(string, optional)*: Cron expression (e.g. `0 8 * * *` for daily at 8am UTC).
* **`provider`** *(string, optional)*: Model provider (`"groq"`, `"anthropic"`, `"openai"`, `"cerebras"`, `"google"`, or `"auto"`). Defaults to `"auto"`.
* **`model`** *(string, optional)*: Explicit model ID or `null` to use provider's default model.
* **`prompt`** *(string, required)*: The goal or turn instruction for the Amethyst agent.
* **`actions`** *(array of strings, optional)*: Pre-approved tools this automation is permitted to call unattended. Any tool not listed here will be refused by `UnattendedGate`.

## Execution

Automations in this directory can be executed via:
1. **GitHub Actions**: Using `.github/workflows/automation-runner.yml` (on schedule or manual dispatch).
2. **Local CLI**:
   ```bash
   python -m backend.automation_worker --automation-file automations/example_briefing.json
   ```
