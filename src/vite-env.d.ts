/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ModelContextTool {
  name: string
  title?: string
  description: string
  inputSchema: object
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  execute(input: unknown): unknown | Promise<unknown>
}

interface Document {
  readonly modelContext?: {
    registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): void | Promise<void>
  }
}
