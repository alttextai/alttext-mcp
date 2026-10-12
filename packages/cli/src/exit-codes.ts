import { AltTextApiError } from "@alttext_ai/core";

export const EXIT = {
  ok: 0,
  other: 1,
  usage: 2,
  auth: 3,
  permission: 4,
  notFound: 5,
  conflict: 6,
  rateLimited: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const BY_ERROR_CODE: Readonly<Record<string, ExitCode>> = {
  invalid_api_key: EXIT.auth,
  api_key_revoked: EXIT.auth,
  full_access_required: EXIT.permission,
  insufficient_scope: EXIT.permission,
  not_found: EXIT.notFound,
  key_revoked: EXIT.conflict,
  idempotent_replay_superseded: EXIT.conflict,
  request_in_progress: EXIT.conflict,
  idempotency_key_reused: EXIT.conflict,
  rate_limited: EXIT.rateLimited,
};

const BY_STATUS: Readonly<Record<number, ExitCode>> = {
  401: EXIT.auth,
  403: EXIT.permission,
  404: EXIT.notFound,
  409: EXIT.conflict,
  429: EXIT.rateLimited,
};

/** An error the CLI raises itself, carrying the exit code to finish with. */
export class CliError extends Error {
  override readonly name = "CliError";
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode = EXIT.other) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function exitCodeFor(error: unknown): ExitCode {
  if (error instanceof CliError) return error.exitCode;
  if (!(error instanceof AltTextApiError)) return EXIT.other;
  return (
    (error.errorCode === null ? undefined : BY_ERROR_CODE[error.errorCode]) ??
    BY_STATUS[error.status] ??
    EXIT.other
  );
}
