import type { TreeNode } from "./tree-view";

const TREE_BRANCH_REGEX = /[├└│├──└──|+-]/;

export function isAsciiTree(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;

  let branchLineCount = 0;
  for (const line of lines) {
    if (
      line.includes("├──") ||
      line.includes("└──") ||
      line.includes("│") ||
      line.includes("|--") ||
      line.includes("+--") ||
      line.includes("\\--")
    ) {
      branchLineCount++;
    }
  }

  return branchLineCount >= Math.min(2, lines.length - 1);
}

export function parseAsciiTree(text: string): TreeNode[] {
  const rawLines = (text || "").trim().split("\n").filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  type StackItem = {
    indent: number;
    node: TreeNode;
  };

  const roots: TreeNode[] = [];
  const stack: StackItem[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];

    // Find the prefix length and branch symbols
    const match = rawLine.match(/^([\s│|]*)(├──|└──|\|\-\-|\+\-\-|\\\-\-)?\s*(.*)$/);
    if (!match) continue;

    const prefix = match[1] || "";
    const hasBranch = Boolean(match[2]);
    let content = match[3] || "";

    if (!content.trim()) continue;

    // Clean label: e.g. "main.py # CLI entry point" -> format nicely
    content = content.trim();

    // Determine nesting depth
    let depth = 0;
    if (!hasBranch && i === 0) {
      depth = 0;
    } else {
      // Calculate depth from prefix length and pipes
      const cleanPrefix = prefix.replace(/\t/g, "    ");
      depth = Math.max(1, Math.floor(cleanPrefix.length / 3) + (hasBranch ? 1 : 0));
    }

    const isFolder = content.endsWith("/") || rawLines[i + 1]?.includes("├──") || rawLines[i + 1]?.includes("└──");
    const cleanLabel = content.replace(/\/$/, "");

    const node: TreeNode = {
      id: `tree-node-${i}-${cleanLabel}`,
      label: cleanLabel,
      children: isFolder ? [] : undefined,
    };

    while (stack.length > 0 && stack[stack.length - 1].indent >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }

    stack.push({ indent: depth, node });
  }

  return roots.length > 0 ? roots : [{ id: "root", label: "Files", children: [] }];
}
