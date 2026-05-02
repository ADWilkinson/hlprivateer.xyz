declare module 'ws' {
  export type RawData = string | ArrayBuffer | ArrayBufferView

  export default class WebSocket {
    static readonly OPEN: number

    constructor(url: string, protocols?: string | string[] | object, options?: object)
    readonly readyState: number
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    on(event: 'pong', listener: () => void): this
    send(data: string | ArrayBuffer | ArrayBufferView, callback?: (err?: Error) => void): void
    ping(): void
    close(): void
    terminate(): void
  }
}
