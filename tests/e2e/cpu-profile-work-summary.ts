export interface CPUProfileWorkNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
  hitCount?: number;
}

export interface CPUProfileWorkInput {
  nodes: CPUProfileWorkNode[];
  samples?: number[];
  timeDeltas?: number[];
}

export interface CPUProfileFunctionSummary {
  functionName: string;
  source: 'bundle' | 'runtime' | 'other';
  line: number | null;
  column: number | null;
  samples: number;
  /** Sum of sampled time intervals assigned to this function, not CPU time. */
  sampleIntervalUs: number | null;
}

export interface CPUProfileWorkSummary {
  status: 'complete' | 'incomplete' | 'invalid' | 'truncated';
  timingBasis: 'sample-intervals-not-cpu-time';
  sampleCount: number | null;
  processedSampleCount: number;
  validSampleCount: number;
  /** Sum of profile sample intervals, never a measurement of CPU execution time. */
  sampleIntervalUs: number | null;
  missingSamples: boolean;
  missingTimeDeltas: boolean;
  invalid: {
    malformedNodes: number;
    duplicateNodeIds: number;
    invalidPositions: number;
    invalidChildLists: number;
    unknownChildren: number;
    duplicateChildReferences: number;
    multipleParents: number;
    cycles: number;
    disconnectedRoots: number;
    invalidSampleIds: number;
    unknownSamples: number;
    ambiguousSamples: number;
    invalidTimeDeltas: number;
    sampleTimeDeltaLengthMismatch: number;
    truncatedNodes: number;
    truncatedSamples: number;
    truncatedEdges: number;
    truncatedAncestorWalks: number;
  };
  self: CPUProfileFunctionSummary[];
  inclusive: CPUProfileFunctionSummary[];
}

const MAX_PROFILE_NODES = 100_000;
const MAX_PROFILE_SAMPLES = 1_000_000;
const MAX_PROFILE_EDGES = 1_000_000;
const MAX_ANCESTOR_STEPS = 5_000_000;
const MAX_FUNCTION_NAME_LENGTH = 80;
const TOP_FUNCTION_LIMIT = 30;

type NormalizedNode = {
  id: number;
  functionName: string;
  source: CPUProfileFunctionSummary['source'];
  line: number | null;
  column: number | null;
  children: number[];
};

type MutableFunctionSummary = Omit<CPUProfileFunctionSummary, 'sampleIntervalUs'> & {
  sampleIntervalUs: number;
};

function safeFunctionName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '(anonymous)';
  // Function names should be identifiers, not source paths or URLs. If a
  // profiler supplies path-like text here, retain no portion of that value.
  if (value.includes('/') || value.includes('\\') || /^https?:/iu.test(value)) return '(anonymous)';
  return value.slice(0, MAX_FUNCTION_NAME_LENGTH)
    .replace(/[^A-Za-z0-9_$<>. ()-]/gu, '?') || '(anonymous)';
}

function sourceKind(value: unknown): CPUProfileFunctionSummary['source'] {
  if (typeof value !== 'string') return 'other';
  const url = value.toLowerCase();
  if (/^(?:node:|internal:|chrome:|devtools:)/u.test(url)
    || /(?:^|[/\\])node_modules(?:[/\\]|$)/u.test(url)) return 'runtime';
  if (/(?:^|[/\\])(?:assets|\.vite|dist)(?:[/\\]|$)/u.test(url)) return 'bundle';
  return 'other';
}

function safePosition(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

function functionKey(node: Pick<NormalizedNode, 'functionName' | 'line' | 'column'>): string {
  return `${node.functionName}\u0000${node.line ?? ''}\u0000${node.column ?? ''}`;
}

function summarizeRows(rows: Map<string, MutableFunctionSummary>): CPUProfileFunctionSummary[] {
  return [...rows.values()]
    .sort((left, right) => right.samples - left.samples
      || right.sampleIntervalUs - left.sampleIntervalUs
      || left.functionName.localeCompare(right.functionName)
      || (left.line ?? -1) - (right.line ?? -1)
      || (left.column ?? -1) - (right.column ?? -1))
    .slice(0, TOP_FUNCTION_LIMIT)
    .map(row => ({ ...row, sampleIntervalUs: row.sampleIntervalUs }));
}

/**
 * Produce bounded, anonymous self and inclusive counts from a CDP CPU profile.
 * `timeDeltas` measure sampled intervals; they are not CPU execution time.
 */
export function summarizeCpuProfileWork(
  input: CPUProfileWorkInput | null | undefined,
): CPUProfileWorkSummary {
  const invalid = {
    malformedNodes: 0,
    duplicateNodeIds: 0,
    invalidPositions: 0,
    invalidChildLists: 0,
    unknownChildren: 0,
    duplicateChildReferences: 0,
    multipleParents: 0,
    cycles: 0,
    disconnectedRoots: 0,
    invalidSampleIds: 0,
    unknownSamples: 0,
    ambiguousSamples: 0,
    invalidTimeDeltas: 0,
    sampleTimeDeltaLengthMismatch: 0,
    truncatedNodes: 0,
    truncatedSamples: 0,
    truncatedEdges: 0,
    truncatedAncestorWalks: 0,
  };
  const samplesPresent = Array.isArray(input?.samples);
  const timeDeltasPresent = Array.isArray(input?.timeDeltas);
  const rawNodes = Array.isArray(input?.nodes) ? input.nodes : [];
  if (!Array.isArray(input?.nodes)) invalid.malformedNodes += 1;

  const truncatedNodes = Math.max(0, rawNodes.length - MAX_PROFILE_NODES);
  invalid.truncatedNodes = truncatedNodes;
  const nodesToRead = rawNodes.slice(0, MAX_PROFILE_NODES);
  const nodeIdCounts = new Map<number, number>();
  for (const candidate of nodesToRead) {
    if (candidate && Number.isSafeInteger(candidate.id)) {
      nodeIdCounts.set(candidate.id, (nodeIdCounts.get(candidate.id) ?? 0) + 1);
    }
  }
  for (const count of nodeIdCounts.values()) {
    if (count > 1) invalid.duplicateNodeIds += count - 1;
  }

  const ambiguousNodeIds = new Set(
    [...nodeIdCounts].filter(([, count]) => count > 1).map(([id]) => id),
  );
  const nodesById = new Map<number, NormalizedNode>();
  for (const candidate of nodesToRead) {
    if (!candidate || !Number.isSafeInteger(candidate.id)
      || !candidate.callFrame || typeof candidate.callFrame !== 'object'
      || typeof candidate.callFrame.functionName !== 'string'
      || typeof candidate.callFrame.url !== 'string') {
      invalid.malformedNodes += 1;
      continue;
    }
    if (ambiguousNodeIds.has(candidate.id)) continue;
    const line = safePosition(candidate.callFrame.lineNumber);
    const column = safePosition(candidate.callFrame.columnNumber);
    if (line === null || column === null) invalid.invalidPositions += 1;
    let children: number[] = [];
    if (candidate.children !== undefined) {
      if (Array.isArray(candidate.children)) children = candidate.children;
      else invalid.invalidChildLists += 1;
    }
    nodesById.set(candidate.id, {
      id: candidate.id,
      functionName: safeFunctionName(candidate.callFrame.functionName),
      source: sourceKind(candidate.callFrame.url),
      line,
      column,
      children,
    });
  }

  const parentById = new Map<number, number>();
  const ambiguousParentIds = new Set<number>();
  let edgesRead = 0;
  for (const node of nodesById.values()) {
    const uniqueChildren = new Set<number>();
    for (const childId of node.children) {
      if (edgesRead >= MAX_PROFILE_EDGES) {
        invalid.truncatedEdges += 1;
        break;
      }
      edgesRead += 1;
      if (!Number.isSafeInteger(childId)) {
        invalid.unknownChildren += 1;
        continue;
      }
      if (uniqueChildren.has(childId)) {
        invalid.duplicateChildReferences += 1;
        continue;
      }
      uniqueChildren.add(childId);
      if (!nodesById.has(childId)) {
        invalid.unknownChildren += 1;
        continue;
      }
      const existingParent = parentById.get(childId);
      if (existingParent === undefined && !ambiguousParentIds.has(childId)) {
        parentById.set(childId, node.id);
      } else if (existingParent !== node.id) {
        invalid.multipleParents += 1;
        ambiguousParentIds.add(childId);
        parentById.delete(childId);
      }
    }
  }

  const parentState = new Map<number, 1 | 2>();
  for (const startId of nodesById.keys()) {
    if (parentState.has(startId)) continue;
    const chain: number[] = [];
    let current: number | undefined = startId;
    while (current !== undefined && !parentState.has(current)) {
      parentState.set(current, 1);
      chain.push(current);
      current = parentById.get(current);
    }
    if (current !== undefined && parentState.get(current) === 1) invalid.cycles += 1;
    for (const nodeId of chain) parentState.set(nodeId, 2);
  }
  const rootCount = [...nodesById.keys()].filter(nodeId => !parentById.has(nodeId)).length;
  invalid.disconnectedRoots = Math.max(0, rootCount - 1);

  const samples = samplesPresent ? input!.samples! : [];
  const sampleCount = samplesPresent ? samples.length : null;
  const processedSampleCount = Math.min(samples.length, MAX_PROFILE_SAMPLES);
  invalid.truncatedSamples = samples.length - processedSampleCount;
  const timeDeltas = timeDeltasPresent ? input!.timeDeltas! : [];
  if (samplesPresent && timeDeltasPresent && samples.length !== timeDeltas.length) {
    invalid.sampleTimeDeltaLengthMismatch = 1;
  }

  let totalIntervalUs = 0;
  if (timeDeltasPresent) {
    for (const delta of timeDeltas.slice(0, MAX_PROFILE_SAMPLES)) {
      if (!Number.isSafeInteger(delta) || delta < 0) invalid.invalidTimeDeltas += 1;
      else {
        totalIntervalUs += delta;
        if (!Number.isSafeInteger(totalIntervalUs)) invalid.invalidTimeDeltas += 1;
      }
    }
  }
  const validTimeSeries = samplesPresent && timeDeltasPresent
    && samples.length === timeDeltas.length && invalid.truncatedSamples === 0
    && invalid.invalidTimeDeltas === 0;

  const selfRows = new Map<string, MutableFunctionSummary>();
  const inclusiveRows = new Map<string, MutableFunctionSummary>();
  let validSampleCount = 0;
  let ancestorSteps = 0;
  const addSample = (
    target: Map<string, MutableFunctionSummary>,
    node: NormalizedNode,
    intervalUs: number,
  ): void => {
    const key = functionKey(node);
    const existing = target.get(key);
    if (existing) {
      existing.samples += 1;
      existing.sampleIntervalUs += intervalUs;
      if (existing.source !== node.source) existing.source = 'other';
    } else {
      target.set(key, {
        functionName: node.functionName,
        source: node.source,
        line: node.line,
        column: node.column,
        samples: 1,
        sampleIntervalUs: intervalUs,
      });
    }
  };

  for (let index = 0; index < processedSampleCount; index += 1) {
    const sampleId = samples[index];
    if (typeof sampleId !== 'number' || !Number.isSafeInteger(sampleId)) {
      invalid.invalidSampleIds += 1;
      continue;
    }
    if (ambiguousNodeIds.has(sampleId)) {
      invalid.ambiguousSamples += 1;
      continue;
    }
    const sampledNode = nodesById.get(sampleId);
    if (!sampledNode) {
      invalid.unknownSamples += 1;
      continue;
    }
    validSampleCount += 1;
    const delta = validTimeSeries ? timeDeltas[index]! : 0;
    addSample(selfRows, sampledNode, delta);

    if (invalid.cycles > 0 || invalid.multipleParents > 0 || invalid.duplicateNodeIds > 0
      || invalid.unknownChildren > 0 || invalid.invalidChildLists > 0 || invalid.truncatedEdges > 0) {
      continue;
    }
    let current: number | undefined = sampleId;
    let chainSteps = 0;
    const visitedFunctionKeys = new Set<string>();
    while (current !== undefined) {
      if (ancestorSteps >= MAX_ANCESTOR_STEPS) {
        invalid.truncatedAncestorWalks += 1;
        break;
      }
      if (chainSteps >= nodesById.size) {
        invalid.cycles += 1;
        break;
      }
      const ancestor = nodesById.get(current);
      if (!ancestor) break;
      const key = functionKey(ancestor);
      if (!visitedFunctionKeys.has(key)) {
        visitedFunctionKeys.add(key);
        addSample(inclusiveRows, ancestor, delta);
      }
      ancestorSteps += 1;
      chainSteps += 1;
      current = parentById.get(current);
    }
  }

  const treeInvalid = invalid.malformedNodes > 0 || invalid.duplicateNodeIds > 0
    || invalid.invalidPositions > 0 || invalid.invalidChildLists > 0
    || invalid.unknownChildren > 0 || invalid.duplicateChildReferences > 0
    || invalid.multipleParents > 0 || invalid.cycles > 0 || invalid.disconnectedRoots > 0
    || invalid.truncatedNodes > 0 || invalid.truncatedEdges > 0
    || invalid.truncatedAncestorWalks > 0;
  const invalidInput = treeInvalid || invalid.invalidSampleIds > 0 || invalid.unknownSamples > 0
    || invalid.ambiguousSamples > 0 || invalid.invalidTimeDeltas > 0
    || invalid.sampleTimeDeltaLengthMismatch > 0;
  const truncated = invalid.truncatedNodes > 0 || invalid.truncatedSamples > 0
    || invalid.truncatedEdges > 0 || invalid.truncatedAncestorWalks > 0;
  const missingSamples = !samplesPresent;
  const missingTimeDeltas = !timeDeltasPresent;
  const status: CPUProfileWorkSummary['status'] = truncated
    ? 'truncated'
    : invalidInput
      ? 'invalid'
      : missingSamples || missingTimeDeltas
        ? 'incomplete'
        : 'complete';
  const sampleIntervalUs = validTimeSeries
    ? totalIntervalUs
    : null;
  const outputSelf = summarizeRows(selfRows).map(row => ({
    ...row,
    sampleIntervalUs: validTimeSeries ? row.sampleIntervalUs : null,
  }));

  return {
    status,
    timingBasis: 'sample-intervals-not-cpu-time',
    sampleCount,
    processedSampleCount,
    validSampleCount,
    sampleIntervalUs,
    missingSamples,
    missingTimeDeltas,
    invalid,
    self: outputSelf,
    inclusive: treeInvalid ? [] : summarizeRows(inclusiveRows).map(row => ({
      ...row,
      sampleIntervalUs: validTimeSeries ? row.sampleIntervalUs : null,
    })),
  };
}
