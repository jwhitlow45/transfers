// A request the server turns away, answered with its status and message rather than logged as a
// failure.
export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
