const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://127.0.0.1:4100'

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path
  }

  return `${API_BASE_URL}${path}`
}

export function wsUrl(): string {
  return WS_BASE_URL
}
