import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Kept to surface the stack in the browser devtools while developing.
    // Replace with a remote reporter when one is wired up.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] p-8">
          <div className="max-w-lg w-full rounded-xl border border-red-500/30 bg-red-900/10 p-6 space-y-4">
            <h1 className="text-xl font-semibold text-red-400">Something went wrong</h1>
            <p className="text-sm text-[var(--color-on-surface)]">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-[var(--color-surface-high)] text-[var(--color-on-surface)] text-sm font-medium hover:bg-[var(--color-surface-highest)]"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
