import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-950/20 p-6 text-center text-slate-200">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-red-200">
            {this.props.fallbackTitle ?? "Topshiriqni yuklashda xatolik yuz berdi"}
          </h3>
          <p className="mt-1 text-xs text-red-300/80 max-w-md">
            {this.props.fallbackMessage ?? this.state.error?.message ?? "Ushbu bo'limni ko'rsatishda kutilmagan xatolik yuz berdi. Iltimos, qayta urinib ko'ring yoki keyingi bo'limga o'ting."}
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg bg-red-600/80 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-600 cursor-pointer"
            >
              Qayta yuklash
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
