export interface OrgAgent {
  slug: string;
  name: string;
  title?: string | null;
  reportsToSlug?: string | null;
  enabled?: boolean;
}

export interface OrgTreeNode {
  slug: string;
  name: string;
  title: string | null;
  reportsToSlug: string | null;
  enabled: boolean;
  children: OrgTreeNode[];
  cycle?: boolean;
}

function compareAgents(a: { name: string; slug: string }, b: { name: string; slug: string }): number {
  const cmp = a.name.localeCompare(b.name);
  if (cmp !== 0) return cmp;
  return a.slug.localeCompare(b.slug);
}

function findCycleNodes(agents: OrgAgent[]): Set<string> {
  const map = new Map(agents.map((a) => [a.slug, a]));
  const cycleNodes = new Set<string>();

  for (const agent of agents) {
    const visited = new Map<string, number>();
    let curr: OrgAgent | undefined = agent;
    let step = 0;
    while (curr) {
      if (visited.has(curr.slug)) {
        let c: OrgAgent | undefined = curr;
        while (c && !cycleNodes.has(c.slug)) {
          cycleNodes.add(c.slug);
          c = c.reportsToSlug ? map.get(c.reportsToSlug) : undefined;
          if (c?.slug === curr.slug) break;
        }
        break;
      }
      visited.set(curr.slug, step++);
      curr = curr.reportsToSlug ? map.get(curr.reportsToSlug) : undefined;
    }
  }

  return cycleNodes;
}

export function buildOrgTree(agents: OrgAgent[]): OrgTreeNode[] {
  const cycleNodes = findCycleNodes(agents);

  const nodeMap = new Map<string, OrgTreeNode>();
  for (const a of agents) {
    const isCycle = cycleNodes.has(a.slug);
    nodeMap.set(a.slug, {
      slug: a.slug,
      name: a.name,
      title: a.title ?? null,
      reportsToSlug: a.reportsToSlug ?? null,
      enabled: a.enabled ?? true,
      children: [],
      ...(isCycle ? { cycle: true } : {}),
    });
  }

  const roots: OrgTreeNode[] = [];

  for (const a of agents) {
    const node = nodeMap.get(a.slug)!;
    if (!a.reportsToSlug || !nodeMap.has(a.reportsToSlug) || cycleNodes.has(a.slug)) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(a.reportsToSlug)!;
      parent.children.push(node);
    }
  }

  function sortNodes(nodes: OrgTreeNode[]): OrgTreeNode[] {
    nodes.sort(compareAgents);
    for (const n of nodes) {
      sortNodes(n.children);
    }
    return nodes;
  }

  return sortNodes(roots);
}

export function findNode(tree: OrgTreeNode[], slug: string): OrgTreeNode | null {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const found = findNode(node.children, slug);
    if (found) return found;
  }
  return null;
}

function isDescendant(node: OrgTreeNode, targetSlug: string): boolean {
  for (const child of node.children) {
    if (child.slug === targetSlug) return true;
    if (isDescendant(child, targetSlug)) return true;
  }
  return false;
}

export function canDrop(tree: OrgTreeNode[], dragSlug: string, targetSlug: string | null): boolean {
  const dragNode = findNode(tree, dragSlug);
  if (!dragNode) return false;
  if (targetSlug === null || targetSlug === "") return true;
  if (targetSlug === dragSlug) return false;
  const targetNode = findNode(tree, targetSlug);
  if (!targetNode) return false;
  if (isDescendant(dragNode, targetSlug)) return false;
  return true;
}
