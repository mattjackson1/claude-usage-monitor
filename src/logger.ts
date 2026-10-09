export interface LogSink {
  appendLine(line: string): void;
  show?(): void;
}

export class Logger {
  private readonly ring: string[] = [];
  debugEnabled = false;

  constructor(
    private readonly sink: LogSink,
    private readonly clock: () => number = Date.now,
    private readonly ringSize = 200,
  ) {}

  info(msg: string): void {
    this.write('INFO', msg);
  }
  warn(msg: string): void {
    this.write('WARN', msg);
  }
  error(msg: string, err?: unknown): void {
    this.write('ERROR', err ? `${msg}: ${err instanceof Error ? err.stack ?? err.message : String(err)}` : msg);
  }
  debug(msg: string): void {
    if (this.debugEnabled) this.write('DEBUG', msg);
  }

  show(): void {
    this.sink.show?.();
  }

  recent(): readonly string[] {
    return this.ring;
  }

  private write(level: string, msg: string): void {
    const line = `${new Date(this.clock()).toISOString()} [${level}] ${msg}`;
    this.ring.push(line);
    if (this.ring.length > this.ringSize) this.ring.shift();
    this.sink.appendLine(line);
  }
}
