export class UnsupportedError extends Error {
  pos: [number, number] | undefined;
  constructor(message: string, pos?: [number, number]) {
    super(message);
    this.name = "UnsupportedError";
    this.pos = pos;
  }
}
