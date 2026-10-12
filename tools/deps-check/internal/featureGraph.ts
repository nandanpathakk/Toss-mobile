import type { Violation } from './violation';

export const FEATURE_CYCLE_RULE = 'no-feature-cycle';

/** The subset of dependency-cruiser's module shape the feature graph consumes. */
export type CruisedModule = { source: string; dependencies: { resolved: string }[] };

const FEATURE_DIR = /^(src\/features\/[^/]+)\//;

function featureOf(path: string): string | null {
  return FEATURE_DIR.exec(path)?.[1] ?? null;
}

/** Feature-level adjacency: A → B when any file of feature A imports any file of feature B (A ≠ B). */
export function featureEdges(modules: CruisedModule[]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const module of modules) {
    const from = featureOf(module.source);
    if (!from) {
      continue;
    }
    for (const dependency of module.dependencies) {
      const to = featureOf(dependency.resolved);
      if (to && to !== from) {
        let targets = edges.get(from);
        if (!targets) {
          targets = new Set();
          edges.set(from, targets);
        }
        targets.add(to);
      }
    }
  }
  return edges;
}

/** Strongly connected components of a directed graph (Tarjan), each as a set of nodes. */
export function stronglyConnectedComponents(edges: Map<string, Set<string>>): Set<string>[] {
  const nodes = new Set<string>([...edges.keys(), ...[...edges.values()].flatMap(targets => [...targets])]);
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: Set<string>[] = [];
  let counter = 0;

  // Iterative DFS: the recursion depth of a naive Tarjan is unbounded in the node count.
  for (const root of [...nodes].sort()) {
    if (index.has(root)) {
      continue;
    }
    const work: { node: string; targets: string[]; next: number }[] = [];
    const visit = (node: string): void => {
      index.set(node, counter);
      lowLink.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);
      work.push({ node, targets: [...(edges.get(node) ?? [])].sort(), next: 0 });
    };
    visit(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next < frame.targets.length) {
        const target = frame.targets[frame.next];
        frame.next += 1;
        if (!index.has(target)) {
          visit(target);
        } else if (onStack.has(target)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node) ?? 0, index.get(target) ?? 0));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowLink.set(parent.node, Math.min(lowLink.get(parent.node) ?? 0, lowLink.get(frame.node) ?? 0));
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component = new Set<string>();
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member !== undefined) {
            onStack.delete(member);
            component.add(member);
          }
        } while (member !== undefined && member !== frame.node);
        components.push(component);
      }
    }
  }
  return components;
}

/**
 * `no-feature-cycle`: every feature → feature edge that lies on a cycle, i.e.
 * whose endpoints share a strongly connected component of the feature graph.
 *
 * Identity is the feature edge, not the component: adding an edge that closes
 * a cycle (or tightens an existing one) is one new violation, and removing an
 * edge can only ever remove violations, so breaking a cycle always ratchets
 * down and never shows up as an addition.
 */
export function featureCycleViolations(modules: CruisedModule[]): Violation[] {
  const edges = featureEdges(modules);
  const componentOf = new Map<string, Set<string>>();
  for (const component of stronglyConnectedComponents(edges)) {
    if (component.size > 1) {
      for (const node of component) {
        componentOf.set(node, component);
      }
    }
  }
  const violations: Violation[] = [];
  for (const from of [...edges.keys()].sort()) {
    for (const to of [...(edges.get(from) ?? [])].sort()) {
      const component = componentOf.get(from);
      if (component?.has(to)) {
        violations.push({ from, to, rule: { name: FEATURE_CYCLE_RULE } });
      }
    }
  }
  return violations;
}
