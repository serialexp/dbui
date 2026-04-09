// ABOUTME: SVG-based dependency graph for PostgreSQL views.
// ABOUTME: Shows how views depend on tables and other views using a layered DAG layout.

import { createSignal, createMemo, For, Show } from "solid-js";
import type { ViewDependency } from "../lib/types";
import { Icon } from "./Icon";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";

interface Props {
  dependencies: ViewDependency[];
  onNodeClick?: (name: string, type: string) => void;
  onRefresh: () => Promise<void>;
}

interface GraphNode {
  name: string;
  type: "table" | "view" | "materialized_view";
  layer: number;
  indexInLayer: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 32;
const LAYER_GAP = 200;
const NODE_GAP = 48;
const PADDING = 40;

export function DependencyGraph(props: Props) {
  const [hoveredNode, setHoveredNode] = createSignal<string | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);

  const graph = createMemo(() => {
    const deps = props.dependencies;
    if (deps.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

    // Collect all nodes and their types
    const nodeTypes = new Map<string, string>();
    const edges: GraphEdge[] = [];

    for (const dep of deps) {
      if (!nodeTypes.has(dep.view_name)) {
        nodeTypes.set(dep.view_name, "view");
      }
      nodeTypes.set(dep.depends_on, dep.depends_on_type);
      edges.push({ from: dep.depends_on, to: dep.view_name });
    }

    // Build adjacency and compute in-degrees
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const name of nodeTypes.keys()) {
      inDegree.set(name, 0);
      adjacency.set(name, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    // Topological sort (Kahn's algorithm) with layer assignment
    const layers = new Map<string, number>();
    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) {
        queue.push(name);
        layers.set(name, 0);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLayer = layers.get(current)!;
      for (const neighbor of adjacency.get(current) || []) {
        const newLayer = currentLayer + 1;
        layers.set(neighbor, Math.max(layers.get(neighbor) || 0, newLayer));
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Handle cycles
    for (const name of nodeTypes.keys()) {
      if (!layers.has(name)) layers.set(name, 0);
    }

    // Group nodes by layer
    const layerGroups = new Map<number, string[]>();
    for (const [name, layer] of layers) {
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer)!.push(name);
    }

    for (const group of layerGroups.values()) {
      group.sort();
    }

    const nodes: GraphNode[] = [];
    for (const [layer, names] of layerGroups) {
      names.forEach((name, index) => {
        nodes.push({
          name,
          type: (nodeTypes.get(name) || "table") as GraphNode["type"],
          layer,
          indexInLayer: index,
        });
      });
    }

    const maxLayer = Math.max(...Array.from(layers.values()), 0);
    const maxPerLayer = Math.max(
      ...Array.from(layerGroups.values()).map((g) => g.length),
      1
    );

    const width = (maxLayer + 1) * LAYER_GAP + NODE_WIDTH + PADDING * 2;
    const height = maxPerLayer * (NODE_HEIGHT + NODE_GAP) - NODE_GAP + PADDING * 2;

    return { nodes, edges, width, height };
  });

  const nodePos = (node: GraphNode) => ({
    x: PADDING + node.layer * LAYER_GAP,
    y: PADDING + node.indexInLayer * (NODE_HEIGHT + NODE_GAP),
  });

  const nodePosMap = createMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of graph().nodes) {
      map.set(node.name, nodePos(node));
    }
    return map;
  });

  const connectedNodes = createMemo(() => {
    const hovered = hoveredNode();
    if (!hovered) return new Set<string>();
    const edges = graph().edges;

    const upstream = new Map<string, string[]>();
    const downstream = new Map<string, string[]>();
    for (const edge of edges) {
      if (!downstream.has(edge.from)) downstream.set(edge.from, []);
      downstream.get(edge.from)!.push(edge.to);
      if (!upstream.has(edge.to)) upstream.set(edge.to, []);
      upstream.get(edge.to)!.push(edge.from);
    }

    const set = new Set<string>();
    set.add(hovered);

    const upQueue = [hovered];
    while (upQueue.length > 0) {
      const current = upQueue.shift()!;
      for (const dep of upstream.get(current) || []) {
        if (!set.has(dep)) {
          set.add(dep);
          upQueue.push(dep);
        }
      }
    }

    const downQueue = [hovered];
    while (downQueue.length > 0) {
      const current = downQueue.shift()!;
      for (const dep of downstream.get(current) || []) {
        if (!set.has(dep)) {
          set.add(dep);
          downQueue.push(dep);
        }
      }
    }

    return set;
  });

  const connectedEdges = createMemo(() => {
    const nodes = connectedNodes();
    if (nodes.size === 0) return new Set<number>();
    const set = new Set<number>();
    graph().edges.forEach((edge, i) => {
      if (nodes.has(edge.from) && nodes.has(edge.to)) set.add(i);
    });
    return set;
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const nodeColor = (type: string) => {
    switch (type) {
      case "table": return "var(--accent-color)";
      case "view": return "var(--text-secondary)";
      case "materialized_view": return "var(--warning-color, #e0a040)";
      default: return "var(--text-secondary)";
    }
  };

  const isActive = () => hoveredNode() !== null;

  return (
    <div class="dependency-graph">
      <div class="dependency-graph-header">
        <div class="dependency-graph-legend">
          <span class="dep-legend-item">
            <span class="dep-legend-dot" style={{ background: "var(--accent-color)" }} />
            Table
          </span>
          <span class="dep-legend-item">
            <span class="dep-legend-dot" style={{ background: "var(--text-secondary)" }} />
            View
          </span>
          <span class="dep-legend-item">
            <span class="dep-legend-dot" style={{ background: "var(--warning-color, #e0a040)" }} />
            Materialized View
          </span>
        </div>
        <button
          class="refresh-button"
          onClick={handleRefresh}
          disabled={refreshing()}
          title="Refresh"
        >
          <Icon svg={arrowsClockwiseSvg} size={14} />
        </button>
      </div>

      <Show
        when={props.dependencies.length > 0}
        fallback={
          <div class="dependency-graph-empty">
            No view dependencies found in this schema.
          </div>
        }
      >
        <div class="dependency-graph-content">
          <svg
            width={graph().width}
            height={graph().height}
            viewBox={`0 0 ${graph().width} ${graph().height}`}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="var(--border-color)" />
              </marker>
              <marker
                id="arrowhead-highlight"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="var(--accent-color)" />
              </marker>
            </defs>

            {/* All edges — rendered once, styled via classes */}
            <For each={graph().edges}>
              {(edge, i) => {
                const fromPos = () => nodePosMap().get(edge.from);
                const toPos = () => nodePosMap().get(edge.to);
                const highlighted = () => connectedEdges().has(i());

                return (
                  <Show when={fromPos() && toPos()}>
                    <line
                      x1={fromPos()!.x + NODE_WIDTH}
                      y1={fromPos()!.y + NODE_HEIGHT / 2}
                      x2={toPos()!.x}
                      y2={toPos()!.y + NODE_HEIGHT / 2}
                      class="dep-edge"
                      classList={{
                        "dep-edge--highlighted": highlighted(),
                        "dep-edge--dimmed": isActive() && !highlighted(),
                      }}
                      marker-end={highlighted() ? "url(#arrowhead-highlight)" : "url(#arrowhead)"}
                    />
                  </Show>
                );
              }}
            </For>

            {/* All nodes — rendered once, styled via classes */}
            <For each={graph().nodes}>
              {(node) => {
                const pos = () => nodePos(node);
                const isHovered = () => hoveredNode() === node.name;
                const connected = () => connectedNodes().has(node.name);
                const dimmed = () => isActive() && !connected();

                return (
                  <g
                    class="dep-node"
                    classList={{ "dep-node--dimmed": dimmed() }}
                    onMouseEnter={() => setHoveredNode(node.name)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => props.onNodeClick?.(node.name, node.type)}
                  >
                    <rect
                      x={pos().x}
                      y={pos().y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={4}
                      class="dep-node-rect"
                      classList={{
                        "dep-node--hovered": isHovered(),
                        "dep-node--connected": connected() && !isHovered(),
                      }}
                      stroke={nodeColor(node.type)}
                    />
                    <text
                      x={pos().x + NODE_WIDTH / 2}
                      y={pos().y + NODE_HEIGHT / 2}
                      class="dep-node-label"
                      text-anchor="middle"
                      dominant-baseline="central"
                    >
                      {node.name.length > 20 ? node.name.slice(0, 18) + "..." : node.name}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>
      </Show>
    </div>
  );
}
