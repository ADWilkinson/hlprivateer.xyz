declare module 'ws' {
  export type RawData = string | ArrayBuffer | ArrayBufferView

  export default class WebSocket {
    constructor(url: string, protocols?: string | string[] | object, options?: object)
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: RawData) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    send(data: string | ArrayBuffer | ArrayBufferView, callback?: (err?: Error) => void): void
    close(): void
  }
}
