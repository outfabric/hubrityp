// Public API of the `notifications` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/notifications`,
// never from internal paths like `@/modules/notifications/server/...`.

export { notify, type NotificationPayload } from './server/notify';
