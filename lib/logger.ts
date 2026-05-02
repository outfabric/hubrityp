import 'server-only';

import pino, { type Logger, type LoggerOptions } from 'pino';

import { serverEnv } from './env';

// LGPD-compliant redaction: every path here will be replaced with `[Redacted]`
// in emitted log entries. Add new paths whenever a sensitive field is
// introduced — see CLAUDE.md ("nunca logar conteúdo, nunca enviar para
// serviços fora do Brasil sem aprovação explícita").
export const redactPaths = [
  '*.cpf',
  '*.email',
  '*.phone',
  '*.password',
  '*.token',
  '*.jwt',
  'cpf',
  'email',
  'phone',
  'password',
  'token',
  'jwt',
  'headers.authorization',
  'headers.cookie',
  'body.message',
  'transcription',
  'note',
];

function resolveLevel(): LoggerOptions['level'] {
  if (serverEnv.NODE_ENV === 'test') return 'silent';
  return serverEnv.LOG_LEVEL;
}

const isDev = serverEnv.NODE_ENV === 'development';

const baseConfig: LoggerOptions = {
  level: resolveLevel(),
  redact: {
    paths: redactPaths,
    censor: '[Redacted]',
  },
};

const transport: LoggerOptions['transport'] = isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
    }
  : undefined;

export const logger: Logger = pino({ ...baseConfig, transport });
