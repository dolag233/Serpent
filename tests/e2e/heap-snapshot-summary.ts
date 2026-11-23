/** Measurement-only: never return snapshot strings containing source names or URLs. */
export type HeapSnapshot = {
  snapshot: { meta: {
    node_fields: string[];
    node_types: Array<string[] | string>;
    edge_fields: string[];
    edge_types: Array<string[] | string>;
  } };
  nodes: number[];
  edges: number[];
  strings: string[];
};

const knownNames = new Set([
  "Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Promise",
  "ArrayBuffer", "SharedArrayBuffer", "Uint8Array", "Uint8ClampedArray",
  "Uint32Array", "Float32Array", "Float64Array", "Blob", "ImageBitmap",
  "HTMLImageElement", "HTMLVideoElement", "HTMLCanvasElement", "HTMLDivElement",
  "Document", "Window", "EventListener", "MutationObserver", "PerformanceObserver",
  "FiberNode", "system / Context", "(GC roots)", "(Strong roots)",
  "(object properties)", "(object elements)", "(Internalized strings)",
  "(Stack roots)", "(Global handles)", "(Global handle roots)",
  "AssetDimensionPublicationTracker", "DeferredVersionedThumbnailPatches",
]);

/** Largest shallow allocations with a shortest non-weak root path, not dominator sizes. */
export function summarizeHeapSnapshot(data: HeapSnapshot) {
  const meta = data.snapshot.meta;
  const ns = meta.node_fields.length;
  const es = meta.edge_fields.length;
  const nt = meta.node_fields.indexOf("type");
  const nn = meta.node_fields.indexOf("name");
  const size = meta.node_fields.indexOf("self_size");
  const count = meta.node_fields.indexOf("edge_count");
  const et = meta.edge_fields.indexOf("type");
  const target = meta.edge_fields.indexOf("to_node");
  const nodeTypes = meta.node_types[nt];
  const edgeTypes = meta.edge_types[et];
  if (!ns || !es || [nt, nn, size, count, et, target].some(index => index < 0)
    || !Array.isArray(nodeTypes) || !Array.isArray(edgeTypes)
    || data.nodes.length % ns || data.edges.length % es) {
    throw new Error("Unsupported heap snapshot schema.");
  }
  const nodeCount = data.nodes.length / ns;
  const offsets = new Uint32Array(nodeCount + 1);
  const totals = new Map<string, { count: number; selfBytes: number }>();
  const constructors = new Map<string, { count: number; selfBytes: number }>();
  const largest: Array<{ index: number; selfBytes: number }> = [];
  const describe = (index: number): string => {
    const type = nodeTypes[data.nodes[index * ns + nt]!] ?? "unknown";
    const rawName = data.strings[data.nodes[index * ns + nn]!];
    return rawName && knownNames.has(rawName) ? `${type}:${rawName}` : type;
  };
  for (let index = 0; index < nodeCount; index += 1) {
    const base = index * ns;
    offsets[index + 1] = offsets[index]! + data.nodes[base + count]! * es;
    const type = nodeTypes[data.nodes[base + nt]!] ?? "unknown";
    const bytes = data.nodes[base + size]!;
    const row = totals.get(type) ?? { count: 0, selfBytes: 0 };
    row.count += 1;
    row.selfBytes += bytes;
    totals.set(type, row);
    const name = data.strings[data.nodes[base + nn]!];
    if (name && knownNames.has(name)) {
      const constructor = constructors.get(name) ?? { count: 0, selfBytes: 0 };
      constructor.count += 1;
      constructor.selfBytes += bytes;
      constructors.set(name, constructor);
    }
    if (largest.length < 20 || bytes > largest[largest.length - 1]!.selfBytes) {
      largest.push({ index, selfBytes: bytes });
      largest.sort((left, right) => right.selfBytes - left.selfBytes);
      if (largest.length > 20) largest.pop();
    }
  }
  if (offsets[nodeCount] !== data.edges.length) throw new Error("Invalid heap snapshot edge counts.");
  const parents = new Int32Array(nodeCount).fill(-1);
  const queue = new Uint32Array(nodeCount);
  let tail = 0;
  if (nodeCount > 0) {
    parents[0] = 0;
    queue[tail++] = 0;
  }
  for (let head = 0; head < tail; head += 1) {
    const from = queue[head]!;
    for (let offset = offsets[from]!; offset < offsets[from + 1]!; offset += es) {
      if (edgeTypes[data.edges[offset + et]!] === "weak") continue;
      const toOffset = data.edges[offset + target]!;
      const to = toOffset / ns;
      if (!Number.isInteger(to) || to < 0 || to >= nodeCount) throw new Error("Invalid heap snapshot target.");
      if (parents[to] !== -1) continue;
      parents[to] = from;
      queue[tail++] = to;
    }
  }
  return {
    nodeCount,
    edgeCount: data.edges.length / es,
    strongReachableCount: tail,
    byType: [...totals].map(([type, row]) => ({ type, ...row }))
      .sort((left, right) => right.selfBytes - left.selfBytes),
    knownConstructors: [...constructors].map(([name, row]) => ({ name, ...row }))
      .sort((left, right) => right.selfBytes - left.selfBytes),
    largestShallowAllocations: largest.map(({ index, selfBytes }) => {
      if (parents[index] === -1) return { kind: describe(index), selfBytes, rootDistance: null, rootPath: [] };
      const reverse: string[] = [];
      let cursor = index;
      for (;;) {
        reverse.push(describe(cursor));
        if (cursor === 0) break;
        cursor = parents[cursor]!;
      }
      const full = reverse.reverse();
      return {
        kind: describe(index), selfBytes, rootDistance: full.length - 1,
        rootPath: full.length <= 24 ? full : [...full.slice(0, 12), "…", ...full.slice(-12)],
      };
    }),
  };
}
