import type { PanelQuery, RangeResponse, InstantResponse, QueryResult } from './types.js';

export function transformQueryResult(data: RangeResponse, pq: PanelQuery): QueryResult {
  const results = data?.data?.result ?? [];
  return {
    refIds: pq.refId,
    legendFormat: pq.legendFormat,
    series: results.map((r) => ({
      labels: r.metric,
      points: (r.values ?? []).map(([ts, val]) => ({ ts: ts * 1000, value: Number.parseFloat(val) })),
    })),
    totalSeries: results.length,
  };
}

export function transformInstantData(data: InstantResponse, query: string) {
  return {
    query,
    series: data.data.result.map((r) => ({
      labels: r.metric,
      points: [{ ts: r.value[0] * 1000, value: Number.parseFloat(r.value[1]) }],
    })),
    totalSeries: data.data.result.length,
  };
}

export function firstInstantValue(data: InstantResponse | null): number {
  const raw = data?.data?.result?.[0]?.value?.[1];
  return raw === undefined ? 0 : Number.parseFloat(raw);
}

export function instantToBarItems(data: InstantResponse | null): Array<{ label: string; value: number }> {
  if (!data) return [];
  return data.data.result.map((r) => {
    const labelEntries = Object.entries(r.metric).filter(([k]) => k !== '__name__');
    const label =
      labelEntries.length > 0
        ? labelEntries.slice(0, 2).map(([, v]) => v).join('/')
        : r.metric['__name__'] ?? 'series';
    return { label, value: Number.parseFloat(r.value[1]) };
  });
}

export function instantToPieItems(data: InstantResponse | null): Array<{ label: string; value: number }> {
  if (!data) return [];
  return data.data.result.map((r) => {
    const labelEntries = Object.entries(r.metric).filter(([k]) => k !== '__name__');
    const label =
      labelEntries.length > 0
        ? labelEntries.slice(0, 2).map(([, v]) => v).join('/')
        : r.metric['__name__'] ?? 'series';
    return { label, value: Number.parseFloat(r.value[1]) };
  });
}

export function instantToHistogramBuckets(data: InstantResponse | null): Array<{ le: string; count: number }> {
  if (!data) return [];
  return data.data.result
    .filter((r) => r.metric['le'] != null)
    .map((r) => ({ le: r.metric['le']!, count: Number.parseFloat(r.value[1]) }))
    .sort((a, b) => {
      const an = a.le === '+Inf' ? Infinity : Number.parseFloat(a.le);
      const bn = b.le === '+Inf' ? Infinity : Number.parseFloat(b.le);
      return an - bn;
    });
}

export function rangeToHeatmapPoints(results: QueryResult[]): Array<{ x: number; y: string; value: number }> {
  const points: Array<{ x: number; y: string; value: number }> = [];
  for (const qr of results) {
    for (const s of qr.series) {
      const le = s.labels['le'];
      let yLabel: string;
      if (le != null) {
        yLabel = le;
      } else {
        const entries = Object.entries(s.labels).filter(([k]) => k !== '__name__');
        yLabel =
          entries.length > 0
            ? entries.slice(0, 2).map(([, v]) => v).join('/')
            : s.labels['__name__'] ?? 'series';
      }
      for (const p of s.points) {
        points.push({ x: p.ts, y: yLabel, value: p.value });
      }
    }
  }
  return points;
}

export function rangeToStatusSpans(results: QueryResult[]): Array<{ label: string; start: number; end: number; status: string }> {
  const spans: Array<{ label: string; start: number; end: number; status: string }> = [];
  for (const qr of results) {
    for (const s of qr.series) {
      const labelEntries = Object.entries(s.labels).filter(([k]) => k !== '__name__');
      const label =
        labelEntries.length > 0
          ? labelEntries.slice(0, 2).map(([, v]) => v).join('/')
          : s.labels['__name__'] ?? 'series';
      let spanStart = 0;
      let lastStatus = '';
      for (let i = 0; i < s.points.length; i += 1) {
        const p = s.points[i]!;
        const status = p.value === 1 ? 'up' : p.value === 0 ? 'down' : String(p.value);
        if (i === 0) {
          lastStatus = status;
          spanStart = p.ts;
        } else if (status !== lastStatus) {
          spans.push({ label, start: spanStart, end: p.ts, status: lastStatus });
          spanStart = p.ts;
          lastStatus = status;
        }
      }
      if (s.points.length > 0) {
        const last = s.points[s.points.length - 1]!;
        spans.push({ label, start: spanStart, end: last.ts, status: lastStatus });
      }
    }
  }
  return spans;
}
