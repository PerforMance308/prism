export interface QuickRange {
  value: string;
  label: string;
}

export const QUICK_RANGES: readonly QuickRange[] = [
  { value: '5m', label: 'Last 5 min' },
  { value: '15m', label: 'Last 15 min' },
  { value: '30m', label: 'Last 30 min' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '3h', label: 'Last 3 hours' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '12h', label: 'Last 12 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '2d', label: 'Last 2 days' },
  { value: '7d', label: 'Last 7 days' },
];
