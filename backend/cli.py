"""AMETHYST command line entry point."""

from __future__ import annotations

import argparse
import asyncio
import platform
import shutil
import sys
from pathlib import Path

from backend import provider_catalogue as catalogue
from backend.agent.director import Director
from backend.config import configured_providers, load_providers, paths
from backend.db.connection import get_connection
from backend.db.repositories import ConversationRepository, ExecutionLogRepository
from backend.security.confirmation import ConfirmationRequest, ConfirmationService
from backend.security.sandbox import platform_backend, unavailable_reason
from backend.skills.loader import scan, seed_builtin_skills
from backend.tools.registry import build_default_registry


async def _ask_terminal(request: ConfirmationRequest) -> bool:
    print(f"\n  AMETHYST wants to run: {request.tool_name}  [{request.risk.value} risk]")
    print(f"  reason: {request.reason}")
    for key, value in request.arguments.items():
        rendered = str(value)
        print(f"    {key}: {rendered[:200]}")
    answer = input("  allow? [y/N/always] ").strip().lower()
    if answer in ("always", "a"):
        from backend.db.repositories import ConfirmationPreferenceRepository

        ConfirmationPreferenceRepository().remember(
            request.operation_key, "allow", request.risk.value
        )
        return True
    return answer in ("y", "yes")


def cmd_init(_: argparse.Namespace) -> int:
    p = paths()
    p.ensure()
    get_connection()
    load_providers()
    from backend.security.sandbox import SandboxPolicy

    SandboxPolicy.load()
    seeded = seed_builtin_skills()

    print(f"AMETHYST initialized at {p.home}")
    print(f"  database:  {p.db}")
    print(f"  providers: {p.providers_yaml}")
    print(f"  skills:    {p.skills_dir}" + (f" (seeded: {', '.join(seeded)})" if seeded else ""))
    backend = platform_backend()
    print(f"  sandbox:   {backend or 'unavailable -- ' + (unavailable_reason() or 'unknown')}")
    return 0


# Providers worth having and not yet listed. The catalogue is the source; this
# only decides which absences are worth mentioning unprompted, and the fast
# open-weights pair are the ones that change how a turn feels.
FAST_PROVIDERS = ("groq", "cerebras")


def cmd_doctor(_: argparse.Namespace) -> int:
    p = paths()
    state = "exists" if p.home.exists() else "MISSING -- run amethyst init"
    print(f"home:      {p.home} ({state})")
    print(f"database:  {p.db} ({'exists' if p.db.exists() else 'missing'})")

    providers = load_providers()
    usable = configured_providers()
    print(f"providers: {', '.join(usable) or 'none configured'}")
    # Summarised, not one line each. providers.yaml lists every provider AMETHYST
    # knows how to reach, so on a fresh install "no key yet" is the normal state
    # of most of them -- eleven warning lines would train the reader to skip the
    # section that also reports the things that are actually wrong.
    keyless = sorted(set(providers) - set(usable))
    if keyless:
        listed = ", ".join(keyless)
        print(f"           {len(keyless)} listed without a key, so not offered: {listed}")
        print("           add one with: amethyst secrets set amethyst/<name>")

    # The starter file is only written when providers.yaml is absent, so an
    # existing one never gains an entry AMETHYST adds later. Reporting the drift is
    # half the job; `amethyst providers add` is the other half.
    for name in FAST_PROVIDERS:
        if name not in providers:
            preset = catalogue.preset(name)
            label = preset.label if preset else name
            print(f"           - {label} is not listed. Add it: amethyst providers add {name}")

    registry = build_default_registry()
    print(f"tools:     {len(registry.list())} registered")

    # Retrieval is quietly the biggest thing that can be broken without saying
    # so: with no embedder reachable, every search falls back to keywords and
    # the vault looks indexed while answering nothing. Reported here because
    # this is the page somebody reads when something feels wrong.
    from backend.retrieval.embeddings import Embedder, configured_embedders
    from backend.retrieval.indexer import Indexer

    embedder = Embedder()
    stats = Indexer().stats()
    print(
        f"retrieval: {embedder.provider}:{embedder.model},"
        f" {stats['documents']} documents, {stats['chunks']} chunks"
    )
    if embedder.provider == "ollama" and shutil.which("ollama") is None:
        others = [n for n in configured_embedders() if n != "ollama"]
        print("           ! Ollama is not installed, so nothing can be embedded.")
        if others:
            names = ", ".join(others)
            print(f"             {names} are configured and can.")
            print("             Point AMETHYST at one: amethyst embeddings detect --set")

    skills, errors = scan()
    print(f"skills:    {len(skills)} loaded, {len(errors)} invalid")
    for err in errors:
        print(f"           ! {err.path}: {err.error}")

    print(f"sandbox:   {platform_backend() or unavailable_reason()}")

    from datetime import date

    from backend import share
    from backend.config import load_instagram, load_journal_schedule
    from backend.instagram import signature as ig_signature
    from backend.instagram.store import InstagramEventStore
    from backend.library.store import LibraryStore
    from backend.media.audio import ffmpeg_missing
    from backend.runtime.transcribe import resolve_transcriber

    schedule = load_journal_schedule()
    print(
        f"journal:   briefing {_at(schedule.briefing_enabled, schedule.briefing_hour)},"
        f" review {_at(schedule.review_enabled, schedule.review_hour)}"
    )
    counts = LibraryStore().counts()
    total = sum(counts.values())
    print(f"library:   {total} item{'' if total == 1 else 's'} logged")

    # Sharing is the one thing here that can be reached from another machine, so
    # it is reported whether it is on or off -- a token somebody created months
    # ago and forgot is exactly the thing a status command exists to surface.
    settings = load_instagram()
    creds = ig_signature.present()
    if settings.enabled and ig_signature.configured():
        print("instagram: on -- POST /api/instagram/webhook")
        allowed = ", ".join(settings.allow_senders) or "nobody yet"
        print(f"           senders allowed: {allowed}")
        print(f"           mentions accepted from: {settings.mentions_from}")
        counts = InstagramEventStore().counts()
        if counts:
            print("           queue: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
        if settings.token_expires_on:
            try:
                left = (date.fromisoformat(settings.token_expires_on) - date.today()).days
                warn = "  <-- reconnect in Settings" if left < 14 else ""
                print(f"           token expires {settings.token_expires_on} ({left} days){warn}")
            except ValueError:
                pass
        transcriber = resolve_transcriber()
        print(
            "           transcription: "
            + (f"{transcriber[0].name} / {transcriber[1]}" if transcriber else "none configured"
               " -- reels will be saved with a title only")
        )
        print(f"           ffmpeg: {'yes' if ffmpeg_missing() is None else 'MISSING'}")
        # The difference between "capture works" and "capture works while this
        # machine is closed" is one line, and it is worth one line here.
        from backend.instagram import relay as ig_relay

        if settings.relay_enabled and ig_relay.configured():
            print(f"           relay: {settings.relay_url} -- deliveries survive this")
            print("           machine being off, and are taken on the next poll.")
        else:
            print("           relay: none. Meta delivers straight here, so a closed")
            print("           lid is a failed delivery. See docs/deployment.md.")
        print("           This endpoint is reachable from the internet by design.")
        print("           Its only authentication is Meta's signature on each delivery.")
    elif any(creds.values()):
        missing = ", ".join(name for name, ok in creds.items() if not ok)
        print(f"instagram: not ready -- still missing: {missing or 'the on switch'}")
    else:
        print("instagram: off (no credentials)")

    if share.enabled():
        print("share:     a capture token is set -- POST /api/share/capture accepts it")
        print("           revoke it with: amethyst share-token --revoke")
        print("           every OTHER endpoint here is unauthenticated by design.")
        print("           If this instance is reachable from the internet, put a proxy")
        print("           in front that publishes only /api/share/capture.")
    else:
        print("share:     off (no capture token)")
    return 0


def _at(enabled: bool, hour: int) -> str:
    return f"{hour:02d}:00" if enabled else "off"


def cmd_chat(args: argparse.Namespace) -> int:
    paths().ensure()
    get_connection()

    conversations = ConversationRepository()
    if args.conversation:
        conversation_id = args.conversation
    else:
        provider = args.provider or next(iter(load_providers()), "ollama")
        model = args.model or (
            load_providers().get(provider).default_model if load_providers().get(provider) else None
        )
        if not model:
            print(f"no default model for provider '{provider}'; pass --model", file=sys.stderr)
            return 1
        conversation_id = conversations.create(provider, model)
        print(f"conversation {conversation_id} ({provider}:{model})")

    confirmation = ConfirmationService(callback=_ask_terminal)
    workspace = (
        str(Path(args.workspace).expanduser().resolve()) if args.workspace else str(Path.cwd())
    )
    registry = build_default_registry(confirmation, workspace_root=workspace)
    director = Director(registry, workspace_root=workspace, stream=True)

    from backend.mcp.manager import MCPManager

    manager = MCPManager(registry, open_browser=True)

    async def turn(message: str) -> None:
        streaming = False
        async for event in director.run(conversation_id, message):
            if event.type == "assistant_delta":
                if not streaming:
                    print()
                    streaming = True
                print(event.data["text"], end="", flush=True)
                continue
            if streaming:
                print()
                streaming = False
            if event.type == "assistant_text":
                # Only reaches here when the provider could not stream, so this
                # is the whole answer and nothing has printed it. Dropping it
                # meant a non-streaming provider -- Google, for one -- answered
                # into an empty terminal.
                print(f"\n{event.data['text']}")
            elif event.type == "warning":
                print(f"  [{event.data['message']}]")
            elif event.type == "tool_call":
                print(f"  -> {event.data['name']}({_brief(event.data['arguments'])})")
            elif event.type == "tool_result":
                marker = "!!" if event.data["is_error"] else "<-"
                print(f"  {marker} {_brief(event.data['content'], 300)}")
            elif event.type == "guard":
                print(f"  [stopped: {event.data['reason']}]")
            elif event.type == "error":
                print(f"  [error: {event.data['message']}]", file=sys.stderr)

    async def session(messages) -> None:
        """Hold MCP connections open for the whole session, not per turn.

        Connecting per turn would respawn every stdio server on each message.
        """
        # Scoped to this conversation: a connector switched off here must not
        # even be started, let alone advertised.
        results = await manager.connect_all(conversation_id=conversation_id)
        connected = {n: v for n, v in results.items() if isinstance(v, int)}
        failed = {n: v for n, v in results.items() if not isinstance(v, int)}
        if connected:
            total = sum(connected.values())
            print(f"MCP: {total} tools from {', '.join(connected)}")
        for name, error in failed.items():
            print(f"MCP: '{name}' unavailable -- {_brief(error, 140)}", file=sys.stderr)
        try:
            async for message in messages:
                await turn(message)
        finally:
            await manager.shutdown()

    async def single(message):
        yield message

    if args.message:
        asyncio.run(session(single(args.message)))
        return 0

    async def prompts():
        print("type a message, or 'exit' to quit")
        loop = asyncio.get_running_loop()
        while True:
            try:
                message = (await loop.run_in_executor(None, input, "\n> ")).strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return
            if message in ("exit", "quit"):
                return
            if message:
                yield message

    asyncio.run(session(prompts()))
    return 0


def cmd_capabilities(args: argparse.Namespace) -> int:
    from backend.capabilities import CapabilityService, Kind

    get_connection()
    service = CapabilityService()

    if args.enable or args.disable:
        name = args.enable or args.disable
        kind = Kind(args.kind) if args.kind else _infer_kind(service, name)
        if kind is None:
            print(f"no skill or connector named '{name}'", file=sys.stderr)
            return 1
        service.set_enabled(kind, name, bool(args.enable), conversation_id=args.conversation)
        scope = args.conversation or "globally"
        state = "on" if args.enable else "off"
        print(f"{kind} '{name}' switched {state} ({scope})")
        return 0

    for group, items in service.overview(args.conversation).items():
        print(f"\n{group}")
        if not items:
            print("  (none)")
        for c in items:
            mark = "on " if c.enabled else "off"
            print(f"  [{mark}] {c.name:<22} {_brief(c.description, 70)}")
    print("\nToggle with:  amethyst capabilities --enable <name>  /  --disable <name>")
    return 0


def _infer_kind(service, name: str):
    from backend.capabilities import Kind

    if any(c.name == name for c in service.skills()):
        return Kind.SKILL
    if any(c.name == name for c in service.connectors()):
        return Kind.CONNECTOR
    return None


def cmd_memory(args: argparse.Namespace) -> int:
    from backend.memory import MemoryStore

    get_connection()
    store = MemoryStore()

    if args.on or args.off:
        store.set_enabled(bool(args.on), conversation_id=args.conversation)
        scope = args.conversation or "globally"
        print(f"memory switched {'on' if args.on else 'off'} ({scope})")
        return 0

    if args.forget:
        if not store.supersede([args.forget]):
            print(f"no live memory with id {args.forget}", file=sys.stderr)
            return 1
        print(f"forgot memory {args.forget}")
        return 0

    if args.forget_all:
        held = store.supersede_all()
        print(f"forgot {held} remembered fact{'s' if held != 1 else ''}")
        return 0

    facts = store.live(args.limit)
    state = "on" if store.is_enabled(args.conversation) else "off"
    scope = args.conversation or "global"
    print(f"memory is {state} ({scope}), {len(facts)} facts held")
    for m in facts:
        print(f"  [{m.id}] {m.created_at[:10]}  {_brief(m.fact, 90)}")
    if not facts:
        print("  (nothing remembered yet)")
    return 0


def cmd_conversations(args: argparse.Namespace) -> int:
    from backend.db.repositories import ConversationRepository

    get_connection()
    repo = ConversationRepository()

    if args.delete_all:
        # Automation runs are left alone here for the same reason the API leaves
        # them: they are the record of what a rule did, and each automation
        # already prunes its own.
        gone = repo.delete_all()
        print(f"deleted {gone} conversation{'s' if gone != 1 else ''}")
        return 0

    rows = repo.list(limit=args.limit)
    if not rows:
        print("no conversations yet")
        return 0
    for row in rows:
        print(f"  {row['id'][:8]}  {row['updated_at'][:16]}  {_brief(row['title'] or '', 60)}")
    return 0


def cmd_index(args: argparse.Namespace) -> int:
    from backend.retrieval.embeddings import Embedder, available
    from backend.retrieval.indexer import Indexer

    paths().ensure()
    get_connection()

    if args.status:
        stats = Indexer().stats()
        print(f"{stats['documents']} documents, {stats['chunks']} chunks indexed")
        return 0

    if not args.path:
        print("give a folder to index, or pass --status", file=sys.stderr)
        return 1

    # Check embeddings once up front, so a misconfigured model fails here rather
    # than part-way through a large vault.
    ok, detail = asyncio.run(available(args.provider, args.model))
    if not ok:
        print(f"embeddings unavailable: {detail}", file=sys.stderr)
        print("\nAMETHYST embeds locally by default. Install Ollama and run:", file=sys.stderr)
        print("  ollama pull nomic-embed-text", file=sys.stderr)
        return 1
    print(f"embedding with {detail}")

    root = Path(args.path).expanduser().resolve()
    indexer = Indexer(Embedder(args.provider, args.model))
    report = asyncio.run(indexer.index_vault(root, prune=not args.no_prune))
    print(report.summary())
    for error in report.errors[:10]:
        print(f"  ! {error}", file=sys.stderr)
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    from backend.retrieval.search import SearchService

    get_connection()
    hits = asyncio.run(SearchService().search(args.query, limit=args.limit))
    if not hits:
        print("no matches")
        return 0
    for hit in hits:
        print(f"\n[{hit.label}]  score {hit.score:.4f}")
        print(f"  {_brief(hit.content, 240)}")
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    for row in reversed(ExecutionLogRepository().recent(args.limit)):
        status = "ERROR" if row["error"] else "ok"
        print(
            f"{row['created_at']}  {row['tool_name']:<24} {row['tool_source']:<11}"
            f" {row['risk_level'] or '-':<7} {row['confirmation_decision'] or '-':<16} {status}"
        )
    return 0


def _brief(value, limit: int = 120) -> str:
    text = str(value).replace("\n", " ")
    return text if len(text) <= limit else text[:limit] + "..."


# ---------------------------------------------------------------------- mcp


def cmd_mcp_catalogue(_: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    by_category: dict[str, list[dict]] = {}
    for entry in mcp.list_catalogue():
        by_category.setdefault(entry["category"], []).append(entry)

    auth_label = {"none": "ready to use", "oauth": "sign in with provider", "setup": "needs setup"}
    for category, entries in by_category.items():
        print(f"\n{category}")
        for e in entries:
            mark = "installed" if e["installed"] else auth_label.get(e["auth"], e["auth"])
            print(f"  {e['id']:<18} {e['title']:<26} ({mark})")
            print(f"  {'':<18} {_brief(e['description'], 90)}")
            if e["requires"]:
                print(f"  {'':<18} requires {e['requires']}")
    print("\nAdd one with:  amethyst mcp add <id>")
    return 0


def cmd_mcp_add(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    try:
        if args.url or args.command:
            transport = args.transport or ("streamable-http" if args.url else "stdio")
            config = mcp.add_custom(
                args.target,
                transport,
                command=args.command,
                args=args.args or [],
                url=args.url,
                oauth=args.oauth,
                allow_local=args.allow_local,
            )
        else:
            config = mcp.add_from_catalogue(args.target, args.name)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"added '{config.name}' ({config.transport})")
    entry = None
    if config.catalogue_id:
        from backend.mcp import catalogue as cat

        entry = cat.get(config.catalogue_id)
    if entry and entry.setup_hint:
        print(f"\nsetup required:\n  {entry.setup_hint}")
    elif config.oauth:
        help_text = mcp.registration_help(config.name, config.catalogue_id)
        fallback = f"\nsign in with:  amethyst mcp login {config.name}"
        print(help_text and f"\n{help_text}" or fallback)
    else:
        print(f"connect with:  amethyst mcp connect {config.name}")
    return 0


def cmd_mcp_remove(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    if mcp.remove(args.name):
        print(f"removed '{args.name}' and forgot its stored credentials")
        return 0
    print(f"no server named '{args.name}'", file=sys.stderr)
    return 1


def cmd_mcp_auth(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    try:
        mcp.set_oauth_client(args.name, args.client_id, args.client_secret)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"stored OAuth client for '{args.name}' (secret in the OS keychain)")
    print(f"sign in with:  amethyst mcp login {args.name}")
    return 0


def cmd_mcp_env(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    if args.unset:
        try:
            removed = mcp.unset_env(args.name, args.unset)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 1
        if not removed:
            print(f"'{args.name}' has no {args.unset}", file=sys.stderr)
            return 1
        print(f"unset {args.unset} for '{args.name}'")
        return 0

    if not args.assignment:
        print("expected KEY=VALUE, or --unset KEY", file=sys.stderr)
        return 1

    key, _, value = args.assignment.partition("=")
    if not key or not value:
        print("expected KEY=VALUE", file=sys.stderr)
        return 1
    try:
        mcp.set_env(args.name, key.strip(), value, secret=args.secret, force=args.force)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    where = "the OS keychain" if args.secret else "mcp.yaml"
    print(f"set {key.strip()} for '{args.name}' in {where}")
    return 0


def cmd_mcp_login(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    if getattr(args, "switch_account", False):
        print(f"signing out of '{args.name}' first, so the provider asks which account")
    print(f"opening your browser to authorize '{args.name}'...")
    print("(complete the sign-in there; this will wait for the redirect)")
    print(
        mcp.run(
            mcp.login(
                args.name,
                force=getattr(args, "switch_account", False),
                account_hint=getattr(args, "account", None),
            )
        )
    )
    return 0


def cmd_mcp_logout(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    try:
        cleared = mcp.sign_out(args.name)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    if not cleared:
        print(f"'{args.name}' had no signed-in account to forget")
        return 0
    print(f"signed out of '{args.name}': forgot {', and '.join(cleared)}")
    print(f"sign in again with:  amethyst mcp login {args.name}")
    return 0


def cmd_mcp_connect(args: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    results = mcp.run(mcp.connect_and_report(args.name, open_browser=False))
    if not results:
        print("no MCP servers configured; try `amethyst mcp catalogue`")
        return 0
    exit_code = 0
    for name, outcome in results.items():
        if isinstance(outcome, int):
            print(f"  {name}: {outcome} tools")
        else:
            print(f"  {name}: {outcome}")
            exit_code = 1
    return exit_code


def cmd_mcp_status(_: argparse.Namespace) -> int:
    from backend.mcp import commands as mcp

    rows = mcp.status()
    if not rows:
        print("no MCP servers configured; try `amethyst mcp catalogue`")
        return 0
    for row in rows:
        auth = ""
        if row["signed_in"] is True:
            auth = " [signed in]"
        elif row["missing_credentials"]:
            auth = f" [needs {', '.join(row['missing_credentials'])}]"
        elif row["signed_in"] is False:
            auth = " [needs sign-in]"
        state = "enabled" if row["enabled"] else "disabled"
        print(f"  {row['name']:<18} {row['transport']:<17} {state}{auth}")
        print(f"  {'':<18} {_brief(row['target'], 90)}")
    return 0


def cmd_mcp_merge_google(args: argparse.Namespace) -> int:
    """Collapse five Google connectors into one, on purpose and never by accident.

    Dry by default. This touches a working Google sign-in, and a migration that
    runs itself is a migration nobody chose.
    """
    from backend.mcp.migrations import apply_google_merge, plan_google_merge

    if not args.apply:
        plan = plan_google_merge()
        print(plan.describe())
        if not plan.is_noop and not plan.already_merged:
            print("\nNothing has been changed. Run again with --apply to do it.")
        return 0

    plan, backup = apply_google_merge()
    if plan.already_merged or plan.is_noop:
        print(plan.describe())
        return 0

    print(f"Merged {', '.join(plan.sources)} into '{plan.target}'.")
    if backup is not None:
        print(f"Previous config: {backup}")
    for warning in plan.warnings:
        print(f"  ! {warning}")
    print(
        "\nThe Google account is untouched. Start it with `amethyst mcp connect"
        f" {plan.target}`, or open Connectors."
    )
    return 0


def _add_mcp_commands(sub) -> None:
    mcp_parser = sub.add_parser("mcp", help="connect external apps over MCP")
    mcp_sub = mcp_parser.add_subparsers(dest="mcp_command", required=True)

    mcp_sub.add_parser("catalogue", help="browse servers you can add").set_defaults(
        func=cmd_mcp_catalogue
    )
    mcp_sub.add_parser("status", help="show configured servers").set_defaults(func=cmd_mcp_status)

    merge = mcp_sub.add_parser(
        "merge-google",
        help="collapse the per-service Google connectors into one workspace-mcp process",
    )
    merge.add_argument(
        "--apply",
        action="store_true",
        help="actually do it; without this the plan is printed and nothing changes",
    )
    merge.set_defaults(func=cmd_mcp_merge_google)

    add = mcp_sub.add_parser("add", help="add a server from the catalogue, or a custom one")
    add.add_argument("target", help="catalogue id, or a name when defining a custom server")
    add.add_argument("--name", help="override the local name")
    add.add_argument("--command", help="custom stdio command")
    add.add_argument("--args", nargs="*", help="arguments for the stdio command")
    add.add_argument("--url", help="custom remote server URL")
    add.add_argument("--transport", choices=["stdio", "sse", "streamable-http"])
    add.add_argument("--oauth", action="store_true", help="the remote server requires OAuth")
    add.add_argument("--allow-local", action="store_true", help="permit a loopback/private URL")
    add.set_defaults(func=cmd_mcp_add)

    remove = mcp_sub.add_parser("remove", help="remove a server and forget its credentials")
    remove.add_argument("name")
    remove.set_defaults(func=cmd_mcp_remove)

    auth = mcp_sub.add_parser("auth", help="attach an OAuth client you registered yourself")
    auth.add_argument("name")
    auth.add_argument("--client-id", required=True)
    auth.add_argument("--client-secret")
    auth.set_defaults(func=cmd_mcp_auth)

    env = mcp_sub.add_parser("env", help="set an environment variable for a stdio server")
    env.add_argument("name")
    env.add_argument("assignment", metavar="KEY=VALUE", nargs="?")
    env.add_argument("--unset", metavar="KEY", help="forget a variable, and its keychain entry")
    env.add_argument(
        "--force",
        action="store_true",
        help="replace a stored secret. Deliberate on purpose: one client backs every\n"
        "connector in an account group, so replacing it changes all of them.",
    )
    env.add_argument(
        "--secret",
        action="store_true",
        help="store the value in the OS keychain; mcp.yaml keeps only a reference",
    )
    env.set_defaults(func=cmd_mcp_env)

    login = mcp_sub.add_parser("login", help="sign in to a server through your browser")
    login.add_argument("name")
    login.add_argument(
        "--switch-account",
        action="store_true",
        help="sign out first, so the provider asks which account to use",
    )
    login.add_argument(
        "--account",
        help="the account to sign in as, for servers that must be told before they can start",
    )
    login.set_defaults(func=cmd_mcp_login)

    logout = mcp_sub.add_parser("logout", help="forget the account a server is signed in as")
    logout.add_argument("name")
    logout.set_defaults(func=cmd_mcp_logout)

    connect = mcp_sub.add_parser("connect", help="connect servers and list their tools")
    connect.add_argument("name", nargs="?", help="omit to connect every enabled server")
    connect.set_defaults(func=cmd_mcp_connect)


# -------------------------------------------------------------------- skills


def cmd_skills(args: argparse.Namespace) -> int:
    """List installed skills, or install one from a URL."""
    import asyncio

    from backend.skills.install import SkillInstallError, install_from_url, remove
    from backend.skills.loader import scan

    if args.install:
        try:
            skill = asyncio.run(install_from_url(args.install, overwrite=args.force))
        except SkillInstallError as exc:
            print(exc, file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"could not install: {exc}", file=sys.stderr)
            return 1
        print(f"installed /{skill.name} -> {skill.path}")
        print(f"  {skill.description}")
        return 0

    if args.remove:
        try:
            removed = remove(args.remove)
        except SkillInstallError as exc:
            print(exc, file=sys.stderr)
            return 1
        if not removed:
            print(f"no skill named '{args.remove}'", file=sys.stderr)
            return 1
        print(f"removed /{args.remove}")
        return 0

    skills, errors = scan()
    if not skills and not errors:
        print("no skills installed; add one with  amethyst skills --install <url>")
        return 0
    for skill in skills:
        version = f" v{skill.version}" if skill.version else ""
        print(f"  /{skill.name}{version}")
        print(f"      {skill.description}")
    for error in errors:
        print(f"  ! {error.path}: {error.error}", file=sys.stderr)
    return 0


# -------------------------------------------------------------- permissions


def cmd_permissions(args: argparse.Namespace) -> int:
    """Show, or take back, the standing 'don't ask again' decisions."""
    from backend.db.repositories import ConfirmationPreferenceRepository

    repo = ConfirmationPreferenceRepository()

    if args.revoke:
        if repo.get(args.revoke) is None:
            print(f"no standing decision for '{args.revoke}'", file=sys.stderr)
            return 1
        repo.clear(args.revoke)
        print(f"revoked {args.revoke} -- it will ask again")
        return 0

    rows = repo.list()
    if not rows:
        print("nothing is approved in advance; every gated call asks")
        return 0
    for row in rows:
        print(
            f"  {row['decision']:<6} {row['operation_key']:<40}"
            f" {row['risk_level']:<7} since {row['created_at']}"
        )
    print("\ntake one back with:  amethyst permissions --revoke <operation-key>")
    return 0


# -------------------------------------------------------------------- serve


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the HTTP API, and the built interface with it if one exists."""
    import uvicorn

    from backend.api.main import _DIST

    url = f"http://{args.host}:{args.port}"
    # AMETHYST has no authentication, by design (ADR-0001): the security model is
    # that it is only reachable from this machine. Binding elsewhere changes
    # that silently, and the person doing it usually means "let my phone reach
    # the share endpoint" rather than "publish my shell".
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"! Binding to {args.host}, which is not loopback.")
        print("! This API has no authentication. Anything that can reach this port")
        print("! can read your files, run shell commands and read your mail.")
        print("! Put a reverse proxy in front of it -- see docs/deployment.md.")
    if (_DIST / "index.html").is_file():
        print(f"AMETHYST is at {url}")
    else:
        print(f"API at {url}/api — no built interface found at {_DIST}")
        print("build it with:  cd frontend && npm install && npm run build")
        print(f"or run the dev server:  npm run dev  (it proxies /api to {url})")
    if args.open:
        import webbrowser

        webbrowser.open(url)
    uvicorn.run(
        "backend.api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )
    return 0


def cmd_desktop(args: argparse.Namespace) -> int:
    """Run AMETHYST in the tray, or arrange for login to do it.

    The same server `serve` runs, with somewhere to live while no window is
    open: an icon, a global hotkey, and a way to quit that is not closing a
    terminal.
    """
    from backend import desktop

    if args.install_autostart:
        print(f"AMETHYST will start at login: {desktop.install_autostart()}")
        return 0
    if args.uninstall_autostart:
        removed = desktop.uninstall_autostart()
        print(f"removed {removed}" if removed else "nothing was set to start at login")
        return 0
    return desktop.run_tray(
        host=args.host,
        port=args.port,
        hotkey=args.hotkey or desktop.DEFAULT_HOTKEY,
        log_level=args.log_level,
        open_browser=args.open,
        native_window=not args.no_window,
    )


def cmd_palette(args: argparse.Namespace) -> int:
    """Open the command palette in the running interface.

    Exists as a command so that a desktop environment can bind a key to it.
    That is the supported route on Wayland, which refuses the global grab
    `amethyst desktop` would otherwise use.
    """
    from backend import desktop

    desktop.summon_palette(args.port)
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    """Switch cross-device sync on, and say where it stands.

    The relay it points at is the same one Instagram capture uses, and this
    writes the same settings -- `amethyst instagram relay` is the other door to
    one room, not a second room. It exists because "run an Instagram command to
    sync your phone" is a sentence nobody should have to be told, and because
    the relay was named after the first thing that needed it rather than the
    only thing.
    """
    from backend.config import load_instagram, save_instagram
    from backend.db.connection import get_connection
    from backend.instagram import relay
    from backend.secrets import CredentialError
    from backend.sync import crypto, devices

    patch: dict = {}
    if args.url:
        url = args.url.strip().rstrip("/")
        if not url.startswith("https://"):
            # Every op travels this link, sealed -- but the device tokens and
            # the pairing handshake travel it too, and those are only as private
            # as the transport.
            print("the relay URL has to be https")
            return 1
        patch["relay_url"] = url
    if args.token:
        try:
            relay.set_token(args.token)
        except CredentialError as exc:
            print(f"could not store the token: {exc}")
            return 1
    if args.on:
        patch["relay_enabled"] = True
    if args.off:
        patch["relay_enabled"] = False
    if patch:
        save_instagram(patch)

    settings = load_instagram()
    if patch.get("relay_enabled") and not relay.configured():
        print("sync needs both a relay URL and its token before it can start")
        print("  amethyst sync --url https://…workers.dev --token <RELAY_TOKEN> --on")
        return 1

    if args.now:
        result = asyncio.run(relay.RelayPoller().sync())
        if not result.get("synced"):
            print(result.get("error") or "the relay was not asked")
            return 1
        print(f"synced. {result.get('ops', 0)} change(s) applied.")
        return 0

    conn = get_connection()
    paired = devices.live(conn)
    print(f"relay:    {settings.relay_url or 'not set'}")
    print(f"polling:  {'on' if settings.relay_enabled and relay.configured() else 'off'}")
    print(f"identity: {devices.local_id(conn)}")
    print(f"key:      {'shared with paired devices' if crypto.group_key() else 'not created yet'}")
    if paired:
        print("devices:")
        for device in paired:
            print(f"  {device.name} ({device.role}) — last seen {device.last_seen_at or 'never'}")
    else:
        print("devices: none paired yet. Add one with: amethyst device --pair")
    if not settings.relay_enabled or not relay.configured():
        print()
        print("Nothing syncs until a relay is set. Deploy one from relay/, then:")
        print("  amethyst sync --url https://…workers.dev --token <RELAY_TOKEN> --on")
    return 0


def cmd_device(args: argparse.Namespace) -> int:
    """List, pair and revoke the devices this machine syncs with.

    Pairing prints a secret and waits. The secret is the only thing that lets the
    far side open what comes back, and it is never sent anywhere -- the relay
    carries two sealed blobs and cannot complete the handshake itself. See
    ADR-0024.
    """
    from backend.db.connection import get_connection, transaction
    from backend.sync import devices

    conn = get_connection()

    if args.revoke:
        with transaction(conn):
            gone = devices.revoke(conn, args.revoke)
        if not gone:
            print(f"no live device has the id {args.revoke}")
            return 1
        print("Revoked. It stops being recognised at the relay within one poll.")
        return 0

    if args.join:
        from backend.config import load_instagram

        secret = args.join.rsplit("s=", 1)[-1].strip()
        relay_url = args.relay or load_instagram().relay_url
        if not relay_url:
            print("no relay is configured. Pass --relay https://…workers.dev,")
            print("or set one up first:  amethyst instagram relay --url …")
            return 1
        print(f"Offering this machine to {relay_url} …")
        print("The other machine answers on its next poll; this can take a minute.")
        try:
            joined = asyncio.run(
                devices.join(relay_url, secret, name=args.name or platform.node())
            )
        except Exception as exc:
            print(f"could not pair: {exc}")
            return 1
        print(f"Paired. This machine is {joined['device_id']}.")
        print("Changes now travel on the relay poll this machine was already making.")
        return 0

    if args.pair:
        secret, payload = devices.open_pairing(name_hint=args.name or "")
        print("Scan this, or type the secret into the other device:")
        print()
        print(f"  {payload}")
        print()
        print(f"  secret: {secret}")
        print()
        print(f"Good for {int(devices.PAIRING_TTL_SECONDS / 60)} minutes, once.")
        print("Leave this machine running: the handshake completes on its next relay poll.")
        return 0

    live = devices.live(conn)
    if not live:
        print("No devices are paired. Run:  amethyst device --pair")
        return 0
    print(f"{'id':38} {'role':9} {'last seen':20} name")
    for device in live:
        print(f"{device.id:38} {device.role:9} {device.last_seen_at or 'never':20} {device.name}")
    return 0


def cmd_share_token(args: argparse.Namespace) -> int:
    """Create, show the state of, or revoke the capture token.

    The token is a bearer credential for exactly one operation: logging a URL
    into the library. It cannot read, list, or run anything.
    """
    from backend import share
    from backend.secrets import CredentialError

    try:
        if args.revoke:
            share.revoke()
            print("Revoked. /api/share/capture no longer exists.")
            return 0
        if args.new:
            token = share.rotate()
            print(token)
            print()
            print("Shown once. Use it as:  Authorization: Bearer <token>")
            print("against:  POST /api/share/capture   {\"url\": \"https://...\"}")
            print()
            print("This token does not make the rest of this API safe to expose.")
            print("See docs/deployment.md before putting AMETHYST on a public address.")
            return 0
    except CredentialError as exc:
        print(f"could not store the token: {exc}")
        return 1

    print("set" if share.enabled() else "not set")
    print("create one with: amethyst share-token --new")
    return 0


def cmd_embeddings(args: argparse.Namespace) -> int:
    """Which model turns text into vectors, and whether it answers."""
    import asyncio

    from backend.config import clear_embeddings, load_embeddings, save_embeddings
    from backend.db.connection import get_connection
    from backend.retrieval import store
    from backend.retrieval.embeddings import Embedder, available, detect
    from backend.retrieval.indexer import Indexer

    action = args.action

    if action == "status":
        chosen = load_embeddings()
        print(f"configured: {':'.join(chosen) if chosen else 'nothing -- using the local default'}")
        embedder = Embedder()
        print(f"in use:     {embedder.provider}:{embedder.model}")
        built = store.indexed_embedding_model(get_connection())
        print(f"index built by: {':'.join(built) if built else 'nothing indexed yet'}")
        if built and chosen and tuple(built) != tuple(chosen):
            print("  the index was built by a different model; re-index to use the new one")
        stats = Indexer().stats()
        print(f"index:      {stats['documents']} documents, {stats['chunks']} chunks")
        ok, detail = asyncio.run(available(embedder.provider, embedder.model))
        print(f"reachable:  {'yes -- ' + detail if ok else 'no'}")
        if not ok:
            print(f"  {detail}")
            print("  try: amethyst embeddings detect")
        return 0

    if action == "detect":
        found = asyncio.run(detect())
        if not found:
            print("no configured provider answered an embedding request.")
            print("Install Ollama (ollama pull nomic-embed-text), or add a provider that embeds.")
            return 1
        for provider, model, dims in found:
            print(f"  {provider:12} {model:34} {dims} dimensions")
        if args.set:
            provider, model, _ = found[0]
            save_embeddings(provider, model)
            print(f"\nset to {provider}:{model}.")
            print("Re-index to rebuild the vectors: amethyst index <path>")
        else:
            first = found[0]
            print(f"\nto use the first: amethyst embeddings set {first[0]} {first[1]}")
        return 0

    if action == "clear":
        clear_embeddings()
        print("back to the local default (Ollama). Re-index to rebuild the vectors.")
        return 0

    # set
    ok, detail = asyncio.run(available(args.provider, args.model))
    if not ok and not args.force:
        print(f"{args.provider}:{args.model} did not answer: {detail}")
        print("Pass --force to set it anyway.")
        return 1
    save_embeddings(args.provider, args.model)
    print(f"embeddings: {args.provider}:{args.model}" + (f" -- {detail}" if ok else ""))
    built = store.indexed_embedding_model(get_connection())
    if built and tuple(built) != (args.provider, args.model):
        # Two models' vectors are not comparable, and the search side already
        # queries with whichever built the index -- so the old index is stale
        # rather than wrong. Saying so is the difference between "no results"
        # and "no results, and here is why".
        print(
            f"the index was built by {':'.join(built)}; it stays stale until you"
            " re-index: amethyst index <path>"
        )
    return 0


def cmd_social(args: argparse.Namespace) -> int:
    """Which sites AMETHYST may read as you, and the credentials that let it."""
    from backend.config import allow_source, load_social, save_social
    from backend.secrets import CredentialError, set_secret
    from backend.web.social import READERS, missing

    action = args.action

    if action == "status":
        settings = load_social()
        print(f"allowed:   {', '.join(settings.allow) or 'nothing yet'}")
        rendering = "r.jina.ai when a page gives up nothing" if settings.reader_fallback else "off"
        print(f"renderer:  {rendering}")
        for reader in READERS:
            state = missing(reader) or "ready"
            mark = "on " if settings.allows(reader.source) else "off"
            print(f"  [{mark}] {reader.source:8} {state}")
        return 0

    if action in {"allow", "deny"}:
        settings = allow_source(args.source, allowed=action == "allow")
        print(f"allowed: {', '.join(settings.allow) or 'nothing'}")
        if action == "allow":
            reader = next((r for r in READERS if r.source == args.source), None)
            if reader is not None:
                problem = missing(reader)
                print(problem if problem else f"{reader.binary} is ready")
        return 0

    if action == "renderer":
        settings = save_social({"reader_fallback": args.state == "on"})
        print(f"page renderer: {'on' if settings.reader_fallback else 'off'}")
        return 0

    # credentials
    stored = 0
    for value, ref, label in (
        (args.x_auth_token, "amethyst/x_auth_token", "X auth_token"),
        (args.x_ct0, "amethyst/x_ct0", "X ct0"),
    ):
        if not value:
            continue
        try:
            set_secret(ref, value)
        except CredentialError as exc:
            print(f"could not store {label}: {exc}")
            return 1
        stored += 1
        print(f"stored {label}")
    if not stored:
        print("nothing to store. Pass --x-auth-token and --x-ct0, read out of a"
              " signed-in browser's cookies for x.com.")
        return 1
    return 0


def cmd_bookmarks(args: argparse.Namespace) -> int:
    """Capture browser bookmarks into the library, and say what is there."""
    import asyncio

    from backend.browser.places import PlacesError, counts, find_profile
    from backend.browser.service import BookmarkIngest
    from backend.config import load_browser, save_browser

    action = args.action

    if action in {"enable", "disable"}:
        settings = save_browser({"enabled": action == "enable"})
        print(f"browser capture is {'on' if settings.enabled else 'off'}")
        return 0

    if action == "profile":
        if args.path:
            save_browser({"profile_dir": args.path})
        try:
            found = find_profile(load_browser().profile_dir or None)
        except PlacesError as exc:
            print(exc)
            return 1
        print(found)
        return 0

    settings = load_browser()
    if action == "status":
        print(f"enabled:   {settings.enabled}")
        print(f"every:     {settings.poll_seconds}s")
        print(f"enrich:    {settings.enrich}")
        try:
            profile = find_profile(settings.profile_dir or None)
        except PlacesError as exc:
            print(f"profile:   {exc}")
            return 0
        print(f"profile:   {profile}")
        found = counts(profile)
        print(
            f"holds:     {found['bookmarks']} bookmarks, {found['pages']} pages,"
            f" {found['visits']} visits"
        )
        return 0

    # sync
    if not settings.enabled:
        print("browser capture is off. Turn it on with: amethyst bookmarks enable")
        return 1
    report = asyncio.run(BookmarkIngest().sync(enrich=not args.no_enrich))
    print(report.summary())
    for failure in report.failed:
        print(f"  {failure}")
    return 1 if report.unavailable else 0


def cmd_instagram(args: argparse.Namespace) -> int:
    """Set up, inspect and exercise Instagram capture."""
    import asyncio
    import json as _json
    from datetime import date, timedelta

    from backend.config import allow_sender, load_instagram, save_instagram
    from backend.instagram import signature
    from backend.instagram.store import InstagramEventStore
    from backend.secrets import CredentialError

    action = args.action
    store = InstagramEventStore()

    if action == "status":
        settings = load_instagram()
        print(f"enabled:   {settings.enabled}")
        for name, ok in signature.present().items():
            print(f"{name + ':':10} {'set' if ok else 'not set'}")
        print(f"owner id:  {settings.owner_ig_id or 'not set'}")
        print(f"senders:   {', '.join(settings.allow_senders) or 'nobody yet'}")
        print(f"mentions:  from {settings.mentions_from}")
        counts = store.counts()
        print("queue:     " + (", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "empty"))
        for row in store.unknown_senders():
            print(f"           {row['sender_id']} was turned away {row['attempts']}x"
                  f" -- allow with: amethyst instagram senders --allow {row['sender_id']}")
        return 0

    if action == "credentials":
        try:
            signature.set_credentials(
                app_secret=args.app_secret,
                verify_token=args.verify_token,
                access_token=args.access_token,
            )
        except CredentialError as exc:
            print(f"could not store: {exc}")
            return 1
        if args.access_token:
            save_instagram(
                {"token_expires_on": (date.today() + timedelta(days=60)).isoformat()}
            )
        if args.owner_id:
            save_instagram({"owner_ig_id": args.owner_id})
        print("stored. Switch capture on with: amethyst instagram enable")
        return 0

    if action in ("enable", "disable"):
        if action == "enable" and not signature.configured():
            print("the app secret, verify token and access token all have to be set first")
            return 1
        save_instagram({"enabled": action == "enable"})
        print(f"capture {'on' if action == 'enable' else 'off'}")
        return 0

    if action == "senders":
        if args.allow:
            print("allowed:", ", ".join(allow_sender(args.allow).allow_senders))
        elif args.deny:
            print("allowed:", ", ".join(allow_sender(args.deny, allowed=False).allow_senders)
                  or "nobody")
        else:
            print(", ".join(load_instagram().allow_senders) or "nobody yet")
        return 0

    if action == "queue":
        rows = store.recent(limit=args.limit)
        if not rows:
            print("nothing has arrived yet")
            return 0
        for row in rows:
            print(f"#{row['id']:<4} {row['status']:<8} {row['route']:<12}"
                  f" from {row['sender_id'] or '?':<18} {row['note'] or ''}")
        return 0

    if action == "retry":
        if not store.requeue(args.id):
            print(f"no instagram event {args.id}")
            return 1
        print(f"event {args.id} is queued again; it runs on the next tick")
        return 0

    if action == "relay":
        return _relay(args, asyncio)

    if action == "send-sample":
        return _send_sample(args, _json, asyncio)

    print(f"unknown action '{action}'")
    return 2


def _relay(args: argparse.Namespace, asyncio) -> int:
    """Point this machine at its relay, or ask the relay what it is holding."""
    from backend.config import load_instagram, save_instagram
    from backend.instagram import relay
    from backend.secrets import CredentialError

    patch: dict = {}
    if args.forget:
        relay.clear_token()
        save_instagram({"relay_url": "", "relay_enabled": False})
        print("forgotten. Meta now has nowhere to deliver to but this machine.")
        return 0
    if args.url:
        url = args.url.strip().rstrip("/")
        if not url.startswith("https://"):
            # The access token travels this link in both directions.
            print("the relay URL has to be https")
            return 1
        patch["relay_url"] = url
    if args.token:
        try:
            relay.set_token(args.token)
        except CredentialError as exc:
            print(f"could not store the token: {exc}")
            return 1
    if args.on:
        patch["relay_enabled"] = True
    if args.off:
        patch["relay_enabled"] = False
    if patch:
        save_instagram(patch)

    settings = load_instagram()
    if patch.get("relay_enabled") and not relay.configured():
        print("the relay needs both a URL and a token before it can be used")
        return 1

    if args.sync:
        result = asyncio.run(relay.RelayPoller().sync())
        if not result.get("synced"):
            print(result.get("error") or result.get("note") or "the relay was not asked")
            return 1
        print(f"took {result['pulled']}, acknowledged {result['acked']},"
              f" {result['queued']} still waiting there")
        return 0

    print(f"url:     {settings.relay_url or 'not set'}")
    print(f"token:   {'set' if relay.token() else 'not set'}")
    print(f"polling: {settings.relay_enabled}")
    if not (settings.relay_enabled and relay.configured()):
        print("\nwithout it, Meta delivers straight to this machine -- which only")
        print("works while it is awake and reachable. See docs/deployment.md.")
    return 0


#: Sample deliveries, in the shapes Meta actually sends. Shared with the tests so
#: the fixtures and the manual loop cannot drift apart.
def _sample_body(route: str) -> dict:
    import time

    now = int(time.time())
    reel = {
        "type": "ig_reel",
        "payload": {
            "title": "a reel someone sent you",
            "url": "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1",
            "video_id": "9",
        },
    }
    messaging = {
        "sender": {"id": "555"},
        "recipient": {"id": "17841400000000000"},
        "timestamp": now * 1000,
        "message": {"mid": f"m_{now}", "attachments": [reel]},
    }
    if route == "dm-link":
        messaging["message"] = {
            "mid": f"m_{now}",
            "text": "look at this https://www.instagram.com/reel/ABC123/",
        }
    elif route == "unsupported":
        messaging["message"] = {"mid": f"m_{now}", "is_unsupported": True, "attachments": []}

    entry: dict = {"id": "17841400000000000", "time": now}
    if route == "mention":
        entry["changes"] = [
            {
                "field": "mentions",
                "value": {"media_id": "17895000000000", "comment_id": f"c_{now}"},
            }
        ]
    else:
        entry["messaging"] = [messaging]
    return {"object": "instagram", "entry": [entry]}


def _send_sample(args: argparse.Namespace, _json, asyncio) -> int:
    """Post a correctly signed sample at a running server.

    The only way to exercise the real path repeatedly without Instagram -- and
    the signature is computed over the exact bytes sent, which is the part that
    is easy to get wrong by hand.
    """
    import hashlib
    import hmac

    import httpx

    from backend.instagram import signature

    secret = signature.app_secret()
    if not secret:
        print("no app secret is stored. Set one with: amethyst instagram credentials"
              " --app-secret ...")
        return 1

    raw = _json.dumps(_sample_body(args.route)).encode()
    digest = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if args.relay:
        # The whole path Meta will take: the relay verifies the signature with
        # its own copy of the app secret, queues the delivery, and this machine
        # collects it on the next sync. A mismatch between the two copies of the
        # app secret shows up here as a 403 rather than as silence weeks later.
        from backend.config import load_instagram

        base = load_instagram().relay_url
        if not base:
            print("no relay is configured. Set one with: amethyst instagram relay --url ...")
            return 1
        url = base.rstrip("/") + "/ig/webhook"
    else:
        url = args.url.rstrip("/") + "/api/instagram/webhook"
    try:
        response = httpx.post(
            url,
            content=raw,
            headers={
                "content-type": "application/json",
                "x-hub-signature-256": f"sha256={digest}",
            },
            timeout=30,
        )
    except httpx.HTTPError as exc:
        print(f"could not reach {url}: {exc}")
        return 1
    print(f"HTTP {response.status_code} {response.text[:200]}")
    if args.relay:
        print("now collect it with: amethyst instagram relay --sync")
    print("watch it with: amethyst instagram queue")
    return 0


# --- secrets ----------------------------------------------------------------
#
# providers.yaml and the docs have told people to run `amethyst secrets set` since
# before there was one; the README worked around its absence by telling them to
# open a Python REPL and import `set_secret`. Storing a key is the one step
# between a listed provider and an offered one, so it gets a command.


def cmd_secrets(args: argparse.Namespace) -> int:
    import os

    from backend.secrets import (
        SERVICE,
        CredentialError,
        delete_secret,
        get_secret,
        set_secret,
    )

    action = args.action
    if action == "list":
        # Values are never printed, here or anywhere. The useful answer is which
        # refs providers.yaml names and which of those the keychain can satisfy.
        providers = load_providers()
        refs = {cfg.api_key_ref for cfg in providers.values() if cfg.api_key_ref}
        if not refs:
            print("no providers declare a keychain reference")
            return 0
        for ref in sorted(refs):
            print(f"{'set    ' if get_secret(ref) else 'missing'}  {ref}")
        return 0

    ref = args.ref
    if "/" not in ref:
        ref = f"{SERVICE}/{ref}"

    if action == "delete":
        delete_secret(ref)
        print(f"deleted {ref}")
        return 0

    value = args.value
    if value is None:
        # Prompted rather than taken as an argument by default: an argument
        # lands in the shell history and in `ps`, which is how a key ends up in
        # a transcript that then has to be rotated.
        import getpass

        value = getpass.getpass(f"value for {ref} (not echoed): ")
    if not value or value != value.strip():
        print("error: a key cannot be empty or padded with whitespace", file=sys.stderr)
        return 1
    try:
        set_secret(ref, value)
    except CredentialError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    where = os.environ.get("AMETHYST_SECRETS_FILE", "").strip()
    print(f"stored {ref} in {where}" if where else f"stored {ref} in the OS keychain")
    return 0


# --- providers --------------------------------------------------------------


def cmd_providers(args: argparse.Namespace) -> int:
    from backend.config import add_provider, remove_provider
    from backend.provider_catalogue import PROVIDER_PRESETS, entry_for

    action = args.action

    if action == "catalogue":
        listed = load_providers()
        for preset in PROVIDER_PRESETS:
            mark = "listed" if preset.slug in listed else "      "
            print(f"{mark}  {preset.slug:<12} {preset.label}")
            if preset.keys_url:
                print(f"                       key: {preset.keys_url}")
        return 0

    if action == "list":
        listed = load_providers()
        usable = configured_providers()
        if not listed:
            print("no providers in providers.yaml")
            return 0
        for name, cfg in listed.items():
            state = "ready" if name in usable else "no key"
            print(f"{state:<7} {name:<12} {cfg.default_model or '(no default model)'}")
        return 0

    if action == "remove":
        if remove_provider(args.name):
            print(f"removed {args.name} from providers.yaml")
            return 0
        print(f"error: no provider named '{args.name}'", file=sys.stderr)
        return 1

    preset = catalogue.preset(args.name)
    if preset is None:
        known = ", ".join(p.slug for p in PROVIDER_PRESETS)
        print(
            f"error: '{args.name}' is not in the catalogue. Known: {known}."
            " Anything else is one hand-written providers.yaml entry --"
            " any OpenAI-compatible endpoint works with no code.",
            file=sys.stderr,
        )
        return 1

    entry = entry_for(preset)
    if args.model:
        entry["default_model"] = args.model
    add_provider(entry)
    print(f"added {preset.slug} to providers.yaml")
    if preset.api_key_ref:
        from backend.secrets import get_secret

        if get_secret(preset.api_key_ref):
            print(f"its key is already in the keychain at {preset.api_key_ref}")
        else:
            print(f"  get a key: {preset.keys_url}")
            print(f"  store it:  amethyst secrets set {preset.api_key_ref}")
    if not entry.get("default_model"):
        print(f"  pick a model: {preset.docs_url}  (amethyst providers add"
              f" {preset.slug} --model ...)")
    return 0



def main(argv: list[str] | None = None) -> int:
    from backend.capabilities import Kind

    parser = argparse.ArgumentParser(prog="amethyst", description="Personal operating system")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="create the AMETHYST home directory and database").set_defaults(
        func=cmd_init
    )
    sub.add_parser("doctor", help="report configuration and component status").set_defaults(
        func=cmd_doctor
    )

    emb = sub.add_parser("embeddings", help="which model turns text into vectors")
    em = emb.add_subparsers(dest="action", required=True)
    em.add_parser("status", help="what is configured, reachable, and what built the index")
    found = em.add_parser("detect", help="probe configured providers for one that embeds")
    found.add_argument("--set", action="store_true", help="use the first one that answers")
    setter = em.add_parser("set", help="name the embedding provider and model")
    setter.add_argument("provider")
    setter.add_argument("model")
    setter.add_argument("--force", action="store_true", help="set it even if it does not answer")
    em.add_parser("clear", help="go back to the local default")
    emb.set_defaults(func=cmd_embeddings)

    soc = sub.add_parser("social", help="read Reddit and X through a signed-in reader")
    sc = soc.add_subparsers(dest="action", required=True)
    sc.add_parser("status", help="which sites are allowed, and whether their readers work")
    allow = sc.add_parser("allow", help="let AMETHYST read a site as you")
    allow.add_argument("source", help="reddit or x")
    deny = sc.add_parser("deny", help="stop reading a site")
    deny.add_argument("source", help="reddit or x")
    renderer = sc.add_parser("renderer", help="send pages that give up nothing to r.jina.ai")
    renderer.add_argument("state", choices=("on", "off"))
    creds = sc.add_parser("credentials", help="store the cookies X's reader needs")
    creds.add_argument("--x-auth-token", help="the auth_token cookie from x.com")
    creds.add_argument("--x-ct0", help="the ct0 cookie from x.com")
    soc.set_defaults(func=cmd_social)

    marks = sub.add_parser("bookmarks", help="capture browser bookmarks into the library")
    bm = marks.add_subparsers(dest="action", required=True)
    bm.add_parser("status", help="what is set up, and what the browser holds")
    sync = bm.add_parser("sync", help="capture bookmarks the library has not seen")
    sync.add_argument(
        "--no-enrich", action="store_true", help="skip the summary and tags model call"
    )
    bm.add_parser("enable", help="start watching for new bookmarks")
    bm.add_parser("disable", help="stop watching")
    which = bm.add_parser("profile", help="show or set which browser profile is read")
    which.add_argument(
        "path", nargs="?", help="the profile directory; omit to show the current one"
    )

    instagram = sub.add_parser("instagram", help="capture reels sent to an Instagram account")
    ig = instagram.add_subparsers(dest="action", required=True)
    ig.add_parser("status", help="what is set up, and what is waiting")
    creds = ig.add_parser("credentials", help="store the three Meta secrets")
    creds.add_argument("--app-secret", help="signs every delivery; from the Meta app dashboard")
    creds.add_argument("--verify-token", help="any string; paste the same one into Meta")
    creds.add_argument("--access-token", help="the long-lived Instagram access token")
    creds.add_argument("--owner-id", help="the Instagram professional account's own id")
    ig.add_parser("enable", help="start accepting deliveries")
    ig.add_parser("disable", help="stop accepting deliveries")
    senders = ig.add_parser("senders", help="who may put things in your library")
    senders.add_argument("--allow", metavar="IGSID")
    senders.add_argument("--deny", metavar="IGSID")
    queue = ig.add_parser("queue", help="what has arrived")
    queue.add_argument("--limit", type=int, default=20)
    retry = ig.add_parser("retry", help="run one delivery again")
    retry.add_argument("id", type=int)
    sample = ig.add_parser(
        "send-sample", help="post a correctly signed sample delivery at a running server"
    )
    sample.add_argument(
        "--route", default="dm-reel", choices=["dm-reel", "dm-link", "mention", "unsupported"]
    )
    sample.add_argument("--url", default="http://127.0.0.1:8000")
    sample.add_argument(
        "--relay", action="store_true",
        help="post at the relay instead, exercising the whole path Meta will take"
    )
    rly = ig.add_parser(
        "relay", help="the always-on receiver that catches deliveries while this machine is off"
    )
    rly.add_argument("--url", help="https://amethyst-relay.<you>.workers.dev")
    rly.add_argument("--token", help="the RELAY_TOKEN the Worker was deployed with")
    rly.add_argument("--on", action="store_true", help="start polling it")
    rly.add_argument("--off", action="store_true", help="stop polling it")
    rly.add_argument("--forget", action="store_true", help="drop the URL and the token")
    rly.add_argument("--sync", action="store_true", help="go and look now")
    marks.set_defaults(func=cmd_bookmarks)
    instagram.set_defaults(func=cmd_instagram)

    syn = sub.add_parser(
        "sync", help="cross-device sync: where it stands, and switching it on"
    )
    syn.add_argument("--url", help="https://amethyst-relay.<you>.workers.dev")
    syn.add_argument("--token", help="the RELAY_TOKEN the Worker was deployed with")
    syn.add_argument("--on", action="store_true", help="start syncing")
    syn.add_argument("--off", action="store_true", help="stop syncing")
    syn.add_argument("--now", action="store_true", help="sync immediately rather than waiting")
    syn.set_defaults(func=cmd_sync)

    dev = sub.add_parser(
        "device", help="the devices this machine syncs with"
    )
    dev.add_argument("--pair", action="store_true", help="show a code to pair a new device")
    dev.add_argument("--name", help="what to call the device being paired")
    dev.add_argument("--join", metavar="SECRET",
                     help="pair THIS machine to another, using the code it showed")
    dev.add_argument("--relay", help="the relay to pair through; defaults to the configured one")
    dev.add_argument("--revoke", metavar="ID", help="stop recognising one device")
    dev.set_defaults(func=cmd_device)

    token = sub.add_parser(
        "share-token", help="the capture token a phone can post a link with"
    )
    token.add_argument("--new", action="store_true", help="generate one, replacing any existing")
    token.add_argument("--revoke", action="store_true", help="delete it; the endpoint disappears")
    token.set_defaults(func=cmd_share_token)

    chat = sub.add_parser("chat", help="talk to AMETHYST")
    chat.add_argument("message", nargs="?", help="single message; omit for an interactive session")
    chat.add_argument("--provider")
    chat.add_argument("--model")
    chat.add_argument("--conversation", help="continue an existing conversation id")
    chat.add_argument("--workspace", help="workspace root for file and shell tools")
    chat.set_defaults(func=cmd_chat)

    secrets = sub.add_parser("secrets", help="store an API key in the OS keychain")
    secrets_sub = secrets.add_subparsers(dest="action", required=True)
    secrets_set = secrets_sub.add_parser(
        "set", help="store a key (prompts, so it stays out of shell history)"
    )
    secrets_set.add_argument("ref", help="keychain reference, e.g. amethyst/groq")
    secrets_set.add_argument("value", nargs="?", help="the key; omit to be prompted")
    secrets_sub.add_parser("list", help="which declared references have a key")
    secrets_delete = secrets_sub.add_parser("delete", help="remove a stored key")
    secrets_delete.add_argument("ref")
    secrets.set_defaults(func=cmd_secrets)

    provs = sub.add_parser("providers", help="list, add or remove model providers")
    provs_sub = provs.add_subparsers(dest="action", required=True)
    provs_sub.add_parser("list", help="what providers.yaml lists and which are ready")
    provs_sub.add_parser("catalogue", help="providers AMETHYST knows how to configure")
    provs_add = provs_sub.add_parser("add", help="add a catalogue provider to providers.yaml")
    provs_add.add_argument("name")
    provs_add.add_argument("--model", help="override the preset's default model")
    provs_remove = provs_sub.add_parser("remove", help="drop an entry from providers.yaml")
    provs_remove.add_argument("name")
    provs.set_defaults(func=cmd_providers)

    logs = sub.add_parser("logs", help="show the tool execution audit trail")
    logs.add_argument("--limit", type=int, default=30)
    logs.set_defaults(func=cmd_logs)

    caps = sub.add_parser("capabilities", help="list or toggle skills and connectors")
    caps.add_argument("--enable", metavar="NAME")
    caps.add_argument("--disable", metavar="NAME")
    caps.add_argument("--kind", choices=[str(k) for k in Kind])
    caps.add_argument("--conversation", help="scope the change to one conversation")
    caps.set_defaults(func=cmd_capabilities)

    memory = sub.add_parser("memory", help="list, forget, or switch off long-term memory")
    memory.add_argument("--forget", type=int, metavar="ID", help="retire one remembered fact")
    memory.add_argument(
        "--forget-all", action="store_true", help="retire every remembered fact"
    )
    memory.add_argument("--on", action="store_true", help="switch memory on")
    memory.add_argument("--off", action="store_true", help="switch memory off")
    memory.add_argument("--conversation", help="scope the change to one conversation")
    memory.add_argument("--limit", type=int, default=50)
    memory.set_defaults(func=cmd_memory)

    conversations = sub.add_parser("conversations", help="list or clear conversations")
    conversations.add_argument(
        "--delete-all", action="store_true", help="delete every conversation and its transcript"
    )
    conversations.add_argument("--limit", type=int, default=20)
    conversations.set_defaults(func=cmd_conversations)

    index = sub.add_parser("index", help="index a folder of notes for retrieval")
    index.add_argument("path", nargs="?", help="folder to index")
    index.add_argument("--status", action="store_true", help="report what is indexed")
    # No default: `Embedder(None)` means "whatever `amethyst embeddings` configured",
    # and hard-coding ollama here made the setting look ignored -- the flag was
    # always passed, so it always won.
    index.add_argument("--provider", help="embedding provider (default: the configured one)")
    index.add_argument("--model", help="embedding model")
    index.add_argument("--no-prune", action="store_true", help="keep entries for deleted files")
    index.set_defaults(func=cmd_index)

    search = sub.add_parser("search", help="search indexed documents")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=6)
    search.set_defaults(func=cmd_search)

    skills = sub.add_parser("skills", help="list, install or remove markdown skills")
    skills.add_argument("--install", metavar="URL", help="install from a URL (GitHub links work)")
    skills.add_argument("--force", action="store_true", help="overwrite one already installed")
    skills.add_argument("--remove", metavar="NAME", help="delete an installed skill")
    skills.set_defaults(func=cmd_skills)

    permissions = sub.add_parser(
        "permissions", help="show or revoke standing 'don't ask again' decisions"
    )
    permissions.add_argument("--revoke", metavar="OPERATION_KEY", help="make it ask again")
    permissions.set_defaults(func=cmd_permissions)

    serve = sub.add_parser("serve", help="run the web interface and API")
    serve.add_argument("--host", default="127.0.0.1", help="bind address (default: loopback only)")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true", help="restart on source changes")
    serve.add_argument("--open", action="store_true", help="open a browser once it is up")
    serve.add_argument("--log-level", default="info")
    serve.set_defaults(func=cmd_serve)

    desk = sub.add_parser("desktop", help="run in the system tray, always available")
    desk.add_argument("--host", default="127.0.0.1", help="bind address (default: loopback only)")
    desk.add_argument("--port", type=int, default=8000)
    desk.add_argument("--hotkey", default=None, help="global chord for the palette")
    desk.add_argument("--open", action="store_true", help="open a browser once it is up")
    desk.add_argument("--log-level", default="warning")
    desk.add_argument(
        "--no-window",
        action="store_true",
        help="do not open a window of its own; use the browser",
    )
    desk.add_argument(
        "--install-autostart", action="store_true", help="start the tray at login"
    )
    desk.add_argument(
        "--uninstall-autostart", action="store_true", help="stop starting it at login"
    )
    desk.set_defaults(func=cmd_desktop)

    pal = sub.add_parser("palette", help="open the command palette in the interface")
    pal.add_argument("--port", type=int, default=8000)
    pal.set_defaults(func=cmd_palette)

    _add_mcp_commands(sub)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
