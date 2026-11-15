import { parseUsbLine, pushUsbChunk, USB_BAUD, type LineBufferState, type UsbPacket } from './usbProtocol.ts'

/** Minimal Web Serial typings (Chromium). */
type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  getInfo: () => { usbVendorId?: number; usbProductId?: number }
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: (options?: { filters?: Array<{ usbVendorId?: number }> }) => Promise<SerialPortLike>
    getPorts: () => Promise<SerialPortLike[]>
  }
}

export function webSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export type UsbLinkHandlers = {
  onPacket: (packet: UsbPacket, line: string) => void
  onFatal: (reason: string) => void
  onDisconnect: () => void
}

export class UsbSerialSession {
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private buffer: LineBufferState = { text: '', badStreak: 0 }
  private closed = false
  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()
  private readonly handlers: UsbLinkHandlers

  constructor(handlers: UsbLinkHandlers) {
    this.handlers = handlers
  }

  get connected(): boolean {
    return this.port !== null && !this.closed
  }

  async connect(): Promise<void> {
    const nav = navigator as SerialNavigator
    if (!nav.serial) throw new Error('serial_unavailable')
    const port = await nav.serial.requestPort()
    await port.open({ baudRate: USB_BAUD })
    this.port = port
    this.closed = false
    this.buffer = { text: '', badStreak: 0 }
    if (!port.writable || !port.readable) throw new Error('port_streams')
    this.writer = port.writable.getWriter()
    this.reader = port.readable.getReader()
    void this.readLoop()
    await this.send({ cmd: 'ping' })
  }

  async disconnect(): Promise<void> {
    this.closed = true
    try {
      await this.send({ cmd: 'stop' })
    } catch {
      /* ignore */
    }
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    try {
      this.reader?.releaseLock()
    } catch {
      /* ignore */
    }
    try {
      this.writer?.releaseLock()
    } catch {
      /* ignore */
    }
    try {
      await this.port?.close()
    } catch {
      /* ignore */
    }
    this.reader = null
    this.writer = null
    this.port = null
    this.handlers.onDisconnect()
  }

  async startSession(sessionId: string): Promise<void> {
    await this.send({ cmd: 'start', session_id: sessionId })
  }

  async stopSession(): Promise<void> {
    await this.send({ cmd: 'stop' })
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    if (!this.writer) throw new Error('not_connected')
    const line = `${JSON.stringify(payload)}\n`
    await this.writer.write(this.encoder.encode(line))
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (!value) continue
        const chunk = this.decoder.decode(value, { stream: true })
        const pushed = pushUsbChunk(this.buffer, chunk, (line) => {
          const parsed = parseUsbLine(line)
          if (parsed.kind === 'packet') this.handlers.onPacket(parsed.packet, line)
          if (parsed.kind === 'fatal') this.handlers.onFatal(parsed.reason)
        })
        this.buffer = pushed.state
        if (pushed.fatal) {
          this.handlers.onFatal(pushed.fatal)
          break
        }
      }
    } catch {
      if (!this.closed) this.handlers.onDisconnect()
    } finally {
      if (!this.closed) {
        this.closed = true
        this.handlers.onDisconnect()
      }
    }
  }
}
