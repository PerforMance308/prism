export interface PanelQuery {
  refId: string;
  expr: string;
  legendFormat?: string;
  instant?: boolean;
  datasourceId?: string;
}

export interface PanelThreshold {
  value: number;
  color: string;
  label?: string;
}

export interface PanelSnapshotData {
  range?: Array<{
    refId: string;
    legendFormat?: string;
    series: Array<{ labels: Record<string, string>; points: Array<{ ts: number; value: number }> }>;
    totalSeries: number;
  }>;
  instant?: {
    data: { result: Array<{ metric: Record<string, string>; value: [number, string] }> };
  };
  capturedAt: string;
}

export interface PanelConfig {
  id: string;
  title: string;
  description?: string;
  queries?: PanelQuery[];
  visualization:
    | 'time_series'
    | 'stat'
    | 'table'
    | 'gauge'
    | 'bar'
    | 'pie'
    | 'histogram'
    | 'heatmap'
    | 'status_timeline';
  unit?: string;
  refreshIntervalSec?: number | null;
  thresholds?: PanelThreshold[];
  stackMode?: 'normal' | 'percent';
  fillOpacity?: number;
  decimals?: number;
  // Backward compat: v1 panels use single query string
  query?: string;
  // Grid placement - backend uses row/col/width/height, frontend aliases gridRow etc.
  row?: number;
  col?: number;
  width?: number;
  height?: number;
  gridRow?: number;
  gridCol?: number;
  gridWidth?: number;
  gridHeight?: number;
  // Section grouping
  sectionId?: string;
  sectionLabel?: string;
  /** When set, panel renders this static data instead of live queries. */
  snapshotData?: PanelSnapshotData;
}

export interface PrometheusRangeResult {
  metric: Record<string, string>;
  values: [number, string][];
}

export interface PrometheusInstantResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface RangeResponse {
  status: string;
  data: { result: PrometheusRangeResult[] };
}

export interface InstantResponse {
  status: string;
  data: { result: PrometheusInstantResult[] };
}

export interface QueryResult {
  refIds: string;
  legendFormat?: string;
  series: Array<{ labels: Record<string, string>; points: Array<{ ts: number; value: number }> }>;
  totalSeries: number;
  error?: string;
}
