const STATIC_API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')
const STATIC_WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? process.env.NEXT_PUBLIC_WS_URL ?? ''

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function runtimeApiBaseUrl(): string {
  if (STATIC_API_BASE_URL) {
    return STATIC_API_BASE_URL
  }

  if (typeof window !== 'undefined') {
    if (isLocalHost(window.location.hostname)) {
      return 'http://127.0.0.1:4000'
    }
  }

  return 'https://api.hlprivateer.xyz'
}

function runtimeWsBaseUrl(): string {
  if (STATIC_WS_BASE_URL) {
    return STATIC_WS_BASE_URL
  }

  if (typeof window !== 'undefined') {
    if (isLocalHost(window.location.hostname)) {
      return 'ws://127.0.0.1:4100'
    }
  }

  return 'wss://ws.hlprivateer.xyz'
}

export function apiUrl(path: string): string {
  return `${runtimeApiBaseUrl()}${path}`
}

export function wsUrl(): string {
  return runtimeWsBaseUrl()
}
