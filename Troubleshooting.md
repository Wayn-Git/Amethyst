# Troubleshooting

Real problems hit while setting up AMETHYST, and the fix for each. If you hit something not
listed here, please add it — that's the point of this file.

## Windows / WSL2

### `run.sh: line 12: $'\r': command not found`

**Cause:** `run.sh` has Windows line endings (CRLF) checked out, and bash expects Unix (LF).
This is a common outcome of Git's line-ending handling on Windows.

**Fix:**
```bash
sed -i 's/\r$//' run.sh
```
(or `dos2unix run.sh` if you have it installed)

Run this from inside your bash/WSL shell — not PowerShell directly, since `sed` doesn't exist
there. From PowerShell you can invoke it as `bash -c "sed -i 's/\r$//' run.sh"`.

### `[ERROR] Node.js (v18+) and npm are required` even though Node is installed

**Cause:** Node.js was installed on the **Windows side**, but `run.sh` runs inside **WSL**,
which has its own separate filesystem and `PATH`. WSL's interop can see `npm` (there's a
shim) but not a bare `node` command — only `node.exe` — and the script looks for `node`.

**Check which situation you're in:**
```bash
which node        # empty if Node isn't installed inside WSL
which node.exe     # a path under /mnt/c/... if only the Windows install is visible
```

**Fix:** install Node natively inside WSL, so it lives in the same environment as bash and
the script:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/setup.sh
sudo bash /tmp/setup.sh
sudo apt-get install -y nodejs
```
Then confirm with `which node` and `node --version` — both should resolve without `.exe`.

### `The virtual environment was not created successfully because ensurepip is not available`

**Cause:** `python3-venv` isn't installed in the WSL/Linux environment.

**Fix:**
```bash
sudo apt update && sudo apt install -y python3-venv python3-pip
```
If you already hit the venv-creation failure once, delete the partially-created `.venv`
before retrying, or the script may skip recreating it:
```bash
rm -rf .venv
```

### `sudo` asks for a password and nothing you type seems to work

This is your **WSL/Linux user password**, set the first time WSL/Ubuntu was installed — not
your Windows login password. Typed characters don't echo to the screen in a Linux terminal;
that's expected, not a bug.

If you don't remember setting one, reset it from a separate PowerShell window:
```powershell
wsl -u root
```
then inside that root shell:
```bash
passwd <your-wsl-username>
```
(find your username with `cat /etc/passwd | grep 1000` if unsure)

### A wall of `[proxy] connect ECONNREFUSED 127.0.0.1:8000` on first `run.sh --dev`

**This is expected, not a failure.** The frontend dev server starts and immediately tries to
reach the backend, which is still booting (Uvicorn's `--reload` watcher takes a few seconds
to come up). The errors stop on their own once you see `Application startup complete.` in
the same terminal output.

### Frontend UI shows "backend is not running" even though the backend works

Confirm the backend is actually up by hitting it directly:
```
http://127.0.0.1:8000/api/ping
```
If that returns `{"status":"ok", ...}`, the backend is fine — the frontend's health-check
just ran once, before the backend finished booting, and never re-checked. A hard refresh
(`Ctrl+Shift+R`) on the frontend tab resolves it.

### A local model (e.g. Ollama) shows as unreachable

Ollama running on the Windows side and AMETHYST's backend running inside WSL don't share
`localhost` cleanly by default — this is the same category of issue as the Node problem
above. If you hit this, check whether Ollama is reachable from inside WSL directly:
```bash
curl http://localhost:11434
```
If that fails, either run Ollama inside WSL itself, or point AMETHYST's provider config at
the Windows host IP (from WSL, find it via `cat /etc/resolv.conf | grep nameserver`) instead
of `localhost`.

---

*Hit something not covered here? Open a PR adding it — a troubleshooting doc is only useful
if it stays current.*