"use client";

import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { AnimatePresence, LayoutGroup, animate, motion, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls, Transition } from "motion/react";
import { Check, ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Copy, Link2, Search, X } from "lucide-react";
import { motionTokens } from "@/lib/motion-tokens";
import styles from "./json-viewer.module.css";

export type JsonValueType = "object" | "array" | "string" | "number" | "boolean" | "null" | "other";

export interface JsonViewerCopyDetail {
  kind: "value" | "path";
  path: string;
  text: string;
}

export interface JsonViewerProps {
  data: unknown;
  /** Name of the root in paths, as in `root.users[0].name`. Defaults to "root". */
  rootName?: string;
  /** Levels open on first render when `defaultExpanded` is not set. Defaults to 1, which opens the root. */
  defaultExpandDepth?: number;
  /** Paths of open branches. */
  expanded?: string[];
  defaultExpanded?: string[];
  onExpandedChange?: (paths: string[]) => void;
  /** Show the search field. Defaults to true. */
  searchable?: boolean;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  /** Children shown per page in a long array or object. Defaults to 50. */
  pageSize?: number;
  /** Show copy value and copy path actions. Defaults to true. */
  copyable?: boolean;
  onCopy?: (detail: JsonViewerCopyDetail) => void;
  /** Called when a row becomes the current one. */
  onSelect?: (detail: { path: string; value: unknown; type: JsonValueType }) => void;
  /** Show the path of the current row under the tree. Defaults to true. */
  showPath?: boolean;
  /** Height of the scrolling tree area. Defaults to 420px. */
  maxHeight?: number | string;
  /** Accessible name of the tree. */
  label?: string;
  className?: string;
}

type Row = {
  id: string;
  kind: "node" | "more";
  level: number;
  name: string | number | null;
  value: unknown;
  type: JsonValueType;
  count: number;
  open: boolean;
  parent: string | null;
  posinset: number;
  setsize: number;
  hidden?: number;
};

const ROW = 28;
const IDENT = /^[A-Za-z_$][\w$]*$/;

function typeOf(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object": return "object";
    case "string": return "string";
    case "number": case "bigint": return "number";
    case "boolean": return "boolean";
    default: return "other";
  }
}

const isBranch = (type: JsonValueType) => type === "object" || type === "array";

function entries(value: unknown): [string | number, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
  return [];
}

const childPath = (parent: string, key: string | number) =>
  typeof key === "number" ? `${parent}[${key}]` : IDENT.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;

const within = (ancestor: string, id: string) =>
  id === ancestor || id.startsWith(`${ancestor}.`) || id.startsWith(`${ancestor}[`);

function primitiveText(value: unknown, type: JsonValueType) {
  if (type === "string") return value as string;
  if (type === "null") return "null";
  return String(value);
}

function copyText(value: unknown, type: JsonValueType) {
  if (type === "string") return value as string;
  if (isBranch(type)) return JSON.stringify(value, null, 2);
  return primitiveText(value, type);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const countLabel = (row: { type: JsonValueType; count: number }) =>
  row.type === "array" ? plural(row.count, "item", "items") : plural(row.count, "key", "keys");

function allBranches(data: unknown, rootName: string) {
  const out: string[] = [];
  const visit = (value: unknown, id: string) => {
    if (!isBranch(typeOf(value))) return;
    out.push(id);
    for (const [key, child] of entries(value)) visit(child, childPath(id, key));
  };
  visit(data, rootName);
  return out;
}

function branchesToDepth(data: unknown, rootName: string, depth: number) {
  const out: string[] = [];
  const visit = (value: unknown, id: string, level: number) => {
    if (level >= depth || !isBranch(typeOf(value))) return;
    out.push(id);
    for (const [key, child] of entries(value)) visit(child, childPath(id, key), level + 1);
  };
  visit(data, rootName, 0);
  return out;
}

type SearchResult = { matches: string[]; ancestors: Set<string>; needed: Map<string, number> };

function searchJson(data: unknown, rootName: string, needle: string): SearchResult {
  const matches: string[] = [];
  const ancestors = new Set<string>();
  const needed = new Map<string, number>();
  const frames: [string, number][] = [];
  const visit = (value: unknown, id: string, name: string | number | null) => {
    if (matches.length >= 2000) return;
    const type = typeOf(value);
    const keyHit = typeof name === "string" && name.toLowerCase().includes(needle);
    const valueHit = !isBranch(type) && primitiveText(value, type).toLowerCase().includes(needle);
    if (keyHit || valueHit) {
      matches.push(id);
      for (const [frame, index] of frames) {
        ancestors.add(frame);
        needed.set(frame, Math.max(needed.get(frame) ?? 0, index + 1));
      }
    }
    if (!isBranch(type)) return;
    entries(value).forEach(([key, child], index) => {
      frames.push([id, index]);
      visit(child, childPath(id, key), key);
      frames.pop();
    });
  };
  visit(data, rootName, null);
  return { matches, ancestors, needed };
}

function Highlight({ text, needle, current }: { text: string; needle: string; current: boolean }) {
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0, at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className={styles.mark} data-current={current || undefined}>
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

type CopyState = "idle" | "done" | "error";

function RowCopyBtn({
  label,
  icon,
  onCopy,
  reduced,
  className,
  focusable = false,
}: {
  label: string;
  icon: ReactNode;
  onCopy: () => Promise<void>;
  reduced: boolean;
  className?: string;
  focusable?: boolean;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = async () => {
    window.clearTimeout(timer.current);
    try {
      await onCopy();
      setState("done");
    } catch {
      setState("error");
    }
    timer.current = window.setTimeout(() => setState("idle"), 1400);
  };

  const glyph =
    state === "done" ? (
      <Check size={13} strokeWidth={2} aria-hidden="true" />
    ) : state === "error" ? (
      <X size={13} strokeWidth={2} aria-hidden="true" />
    ) : (
      icon
    );

  return (
    <button
      type="button"
      tabIndex={focusable ? undefined : -1}
      className={[styles.action, className].filter(Boolean).join(" ")}
      data-state={state}
      aria-label={state === "done" ? "Copied" : state === "error" ? "Copy failed" : label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        void run();
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          className={styles.actionGlyph}
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.12 }}
        >
          {glyph}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

export const JsonViewer = forwardRef<HTMLDivElement, JsonViewerProps>(function JsonViewer(
  {
    data,
    rootName = "root",
    defaultExpandDepth = 1,
    expanded: expandedProp,
    defaultExpanded,
    onExpandedChange,
    searchable = true,
    query: queryProp,
    defaultQuery = "",
    onQueryChange,
    pageSize = 50,
    copyable = true,
    onCopy,
    onSelect,
    showPath = true,
    maxHeight = 360,
    label = "JSON",
    className,
  },
  ref
) {
  const reduced = !!useReducedMotion();
  const uid = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [expandedInternal, setExpandedInternal] = useState<string[]>(() =>
    defaultExpanded ?? branchesToDepth(data, rootName, defaultExpandDepth)
  );
  const expandedList = expandedProp ?? expandedInternal;
  const base = useMemo(() => new Set(expandedList), [expandedList]);

  const setExpanded = useCallback(
    (next: Set<string>) => {
      const list = [...next];
      if (expandedProp === undefined) setExpandedInternal(list);
      onExpandedChange?.(list);
    },
    [expandedProp, onExpandedChange]
  );

  const [queryInternal, setQueryInternal] = useState(defaultQuery);
  const query = queryProp ?? queryInternal;
  const needle = query.trim().toLowerCase();
  const setQuery = (next: string) => {
    if (queryProp === undefined) setQueryInternal(next);
    onQueryChange?.(next);
  };

  const search = useMemo<SearchResult | null>(
    () => (needle ? searchJson(data, rootName, needle) : null),
    [data, needle, rootName]
  );
  const [closedWhileSearching, setClosedWhileSearching] = useState<{ needle: string; ids: Set<string> }>({
    needle: "",
    ids: new Set(),
  });
  const closed = closedWhileSearching.needle === needle ? closedWhileSearching.ids : null;
  const [matchIndex, setMatchIndex] = useState(0);
  const matchCount = search?.matches.length ?? 0;
  const matchSet = useMemo(() => new Set(search?.matches ?? []), [search]);
  const currentMatch = search && matchCount ? search.matches[Math.min(matchIndex, matchCount - 1)] : null;

  const isOpen = useCallback(
    (id: string) => {
      if (search && search.ancestors.has(id)) return !closed?.has(id);
      return base.has(id);
    },
    [base, closed, search]
  );

  const [pages, setPages] = useState<Record<string, number>>({});
  const limitOf = useCallback(
    (id: string) => Math.max((pages[id] ?? 1) * pageSize, search?.needed.get(id) ?? 0),
    [pageSize, pages, search]
  );

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visit = (
      value: unknown,
      id: string,
      name: string | number | null,
      level: number,
      parent: string | null,
      posinset: number,
      setsize: number
    ) => {
      const type = typeOf(value);
      const list = isBranch(type) ? entries(value) : [];
      const open = isBranch(type) && isOpen(id);
      out.push({ id, kind: "node", level, name, value, type, count: list.length, open, parent, posinset, setsize });
      if (!open) return;
      const limit = limitOf(id);
      const shown = list.slice(0, limit);
      const more = list.length - shown.length;
      const size = shown.length + (more > 0 ? 1 : 0);
      shown.forEach(([key, child], index) => visit(child, childPath(id, key), key, level + 1, id, index + 1, size));
      if (more > 0)
        out.push({
          id: `${id}::more`,
          kind: "more",
          level: level + 1,
          name: null,
          value: null,
          type: "other",
          count: 0,
          open: false,
          parent: id,
          posinset: size,
          setsize: size,
          hidden: more,
        });
    };
    visit(data, rootName, null, 1, null, 1, 1);
    return out;
  }, [data, isOpen, limitOf, rootName]);

  const [activeRaw, setActiveRaw] = useState(rootName);
  const active = useMemo(() => {
    if (rows.some((row) => row.id === activeRaw)) return activeRaw;
    let best = rootName;
    for (const row of rows)
      if (row.kind === "node" && within(row.id, activeRaw) && row.id.length > best.length) best = row.id;
    return best;
  }, [activeRaw, rootName, rows]);
  const activeIndex = Math.max(0, rows.findIndex((row) => row.id === active));
  const activeRow = rows[activeIndex];

  const scrollFlight = useRef<AnimationPlaybackControls | null>(null);
  const reveal = useCallback(
    (index: number, center: boolean) => {
      const tree = treeRef.current;
      if (!tree) return;
      const top = index * ROW,
        bottom = top + ROW,
        view = tree.clientHeight,
        now = tree.scrollTop;
      let target = now;
      if (center) target = top - view / 2 + ROW / 2;
      else if (top < now + 4) target = top - 4;
      else if (bottom > now + view - 4) target = bottom - view + 4;
      target = Math.max(0, target);
      if (Math.abs(target - now) < 1) return;
      scrollFlight.current?.stop();
      if (reduced) {
        tree.scrollTop = target;
        return;
      }
      scrollFlight.current = animate(now, target, {
        type: "spring",
        stiffness: 300,
        damping: 30,
        onUpdate: (value) => {
          tree.scrollTop = value;
        },
      });
    },
    [reduced]
  );

  const moveTo = (id: string, focus = true, how: "nearest" | "center" = "nearest") => {
    setActiveRaw(id);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) reveal(idx, how === "center");
    if (focus) rowRefs.current.get(id)?.focus({ preventScroll: true });
  };

  const toggle = (id: string, next?: boolean) => {
    const open = isOpen(id);
    const want = next ?? !open;
    if (want === open) return;
    if (search?.ancestors.has(id)) {
      const ids = new Set(closed ?? []);
      if (want) ids.delete(id);
      else ids.add(id);
      setClosedWhileSearching({ needle, ids });
      if (want && !base.has(id)) setExpanded(new Set(base).add(id));
      return;
    }
    const nextSet = new Set(base);
    if (want) nextSet.add(id);
    else nextSet.delete(id);
    setExpanded(nextSet);
  };

  const expandAll = () => {
    setExpanded(new Set(allBranches(data, rootName)));
    setClosedWhileSearching({ needle, ids: new Set() });
  };

  const collapseAll = () => {
    const rootOpen = isBranch(typeOf(data)) ? [rootName] : [];
    setExpanded(new Set(rootOpen));
    setClosedWhileSearching({ needle, ids: new Set([...(search?.ancestors ?? [])].filter((id) => id !== rootName)) });
    setPages({});
    moveTo(rootName, false, "nearest");
  };

  const showMore = (parent: string) =>
    setPages((current) => ({ ...current, [parent]: Math.ceil(limitOf(parent) / pageSize) + 1 }));

  const copy = async (row: Row, kind: "value" | "path") => {
    const text = kind === "path" ? row.id : copyText(row.value, row.type);
    await writeClipboard(text);
    onCopy?.({ kind, path: row.id, text });
  };

  const stepMatch = (step: number) => {
    if (!search || !matchCount) return;
    const next = ((Math.min(matchIndex, matchCount - 1) + step) % matchCount + matchCount) % matchCount;
    setMatchIndex(next);
    moveTo(search.matches[next], false, "center");
  };

  const onQuery = (next: string) => {
    setQuery(next);
    setMatchIndex(0);
    const trimmed = next.trim().toLowerCase();
    if (trimmed) {
      const first = searchJson(data, rootName, trimmed).matches[0];
      if (first) moveTo(first, false, "center");
    }
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      onQuery("");
    }
  };

  const heightStyle = { "--json-max-height": typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight } as CSSProperties;

  return (
    <div ref={ref} className={[styles.root, className].filter(Boolean).join(" ")} style={heightStyle}>
      {searchable || rows.length > 1 ? (
        <div className={styles.toolbar}>
          {searchable ? (
            <label className={styles.search}>
              <Search size={14} strokeWidth={1.75} aria-hidden="true" className={styles.searchIcon} />
              <input
                ref={searchRef}
                type="search"
                className={styles.input}
                value={query}
                placeholder="Search keys and values..."
                aria-label="Search JSON"
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                spellCheck={false}
                autoComplete="off"
              />
              {needle ? (
                <span className={styles.matches}>
                  <span className={styles.count} aria-live="polite">
                    {matchCount ? `${Math.min(matchIndex, matchCount - 1) + 1}/${matchCount}` : "0/0"}
                  </span>
                  <button type="button" className={styles.tool} aria-label="Previous match" disabled={!matchCount} onClick={() => stepMatch(-1)}>
                    <ChevronUp size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <button type="button" className={styles.tool} aria-label="Next match" disabled={!matchCount} onClick={() => stepMatch(1)}>
                    <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </label>
          ) : (
            <span className={styles.grow} />
          )}
          <span className={styles.divider} aria-hidden="true" />
          <button type="button" className={styles.tool} aria-label="Expand all" title="Expand all" onClick={expandAll}>
            <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className={styles.tool} aria-label="Collapse all" title="Collapse all" onClick={collapseAll}>
            <ChevronsDownUp size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div ref={treeRef} role="tree" aria-label={label} className={styles.tree}>
        {rows.map((row) => {
          const isActive = row.id === active;
          const branch = isBranch(row.type);
          const matched = !!search && row.kind === "node" && matchSet.has(row.id);
          const isCurrentMatch = row.id === currentMatch;
          const mark = matched ? needle : "";

          return (
            <div
              key={row.id}
              ref={(node) => {
                if (node) rowRefs.current.set(row.id, node);
                else rowRefs.current.delete(row.id);
              }}
              role="treeitem"
              tabIndex={isActive ? 0 : -1}
              className={styles.row}
              data-kind={row.kind}
              data-active={isActive || undefined}
              style={{ "--level": row.level - 1 } as CSSProperties}
              onClick={() => {
                if (row.kind === "more") {
                  showMore(row.parent!);
                  moveTo(row.id);
                  return;
                }
                if (branch) toggle(row.id);
                moveTo(row.id);
              }}
            >
              {isActive ? <span className={styles.highlight} aria-hidden="true" /> : null}
              <span className={styles.line}>
                {row.kind === "more" ? (
                  <span className={styles.more}>
                    <span className={styles.moreLabel}>Show {Math.min(pageSize, row.hidden ?? 0)} more</span>
                    <span className={styles.muted}>{row.hidden} hidden</span>
                  </span>
                ) : (
                  <>
                    <span className={styles.chevron} data-open={row.open || undefined} data-branch={branch || undefined} aria-hidden="true">
                      {branch ? <ChevronRight size={13} strokeWidth={1.75} /> : null}
                    </span>
                    <span className={typeof row.name === "number" ? styles.index : styles.key}>
                      {row.name === null ? rootName : typeof row.name === "number" ? row.name : <Highlight text={row.name} needle={mark} current={isCurrentMatch} />}
                    </span>
                    <span className={styles.colon} aria-hidden="true">
                      {row.name === null && branch ? "" : ":"}
                    </span>
                    {branch ? (
                      <span className={styles.summary}>
                        {!row.open ? (
                          <span className={styles.preview}>
                            {row.type === "array"
                              ? "[…]"
                              : `{ ${entries(row.value).slice(0, 3).map(([key]) => key).join(", ")}${row.count > 3 ? ", …" : ""} }`}
                          </span>
                        ) : null}
                        <span className={styles.countLabel}>{countLabel(row)}</span>
                      </span>
                    ) : (
                      <span className={styles.value} data-type={row.type}>
                        {row.type === "string" ? (
                          <>&quot;<Highlight text={row.value as string} needle={mark} current={isCurrentMatch} />&quot;</>
                        ) : (
                          <Highlight text={primitiveText(row.value, row.type)} needle={mark} current={isCurrentMatch} />
                        )}
                      </span>
                    )}
                    {copyable ? (
                      <span className={styles.actions}>
                        <RowCopyBtn label="Copy value" icon={<Copy size={13} strokeWidth={1.75} aria-hidden="true" />} reduced={reduced} onCopy={() => copy(row, "value")} />
                        <RowCopyBtn label="Copy path" icon={<Link2 size={13} strokeWidth={1.75} aria-hidden="true" />} reduced={reduced} onCopy={() => copy(row, "path")} />
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {showPath && activeRow ? (
        <div className={styles.pathBar}>
          <code className={styles.path}>{activeRow.kind === "node" ? activeRow.id : activeRow.parent}</code>
          <span className={styles.pathType}>
            {activeRow.kind === "node" ? (isBranch(activeRow.type) ? `${activeRow.type}, ${countLabel(activeRow)}` : activeRow.type) : "page"}
          </span>
          {copyable && activeRow.kind === "node" ? (
            <RowCopyBtn key={activeRow.id} focusable className={styles.pathCopy} label="Copy path" icon={<Copy size={13} strokeWidth={1.75} aria-hidden="true" />} reduced={reduced} onCopy={() => copy(activeRow, "path")} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default JsonViewer;
