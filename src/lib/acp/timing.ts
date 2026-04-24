export class AcpTiming {
  private start: number;
  private last: number;
  constructor(private sessionId: string) {
    this.start = performance.now();
    this.last = this.start;
  }
  mark(step: string): void {
    const now = performance.now();
    const elapsed = Math.round(now - this.last);
    const total = Math.round(now - this.start);
    console.log(
      `[acp-timing] session=${this.sessionId} step=${step} elapsed=+${elapsed}ms total=${total}ms`,
    );
    this.last = now;
  }
}
