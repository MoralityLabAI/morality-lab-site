export {};

declare global {
  interface Window {
    ai: {
      runCodex: (payload: { prompt: string; cwd?: string; codexPath?: string }) => Promise<string>;
      getDefaultCwd: () => Promise<string>;
      onData: (handler: (event: { runId: string; stream: 'stdout' | 'stderr'; data: string }) => void) => void;
      onDone: (handler: (event: { runId: string; code: number | null }) => void) => void;
      onError: (handler: (event: { runId: string; message: string }) => void) => void;
    };
  }
}
