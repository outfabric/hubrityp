// Public API of the `notifications` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/notifications`,
// never from internal paths like `@/modules/notifications/server/...`.

export { notify, type NotificationPayload } from './server/notify';

// ---- Read Server Actions (bell / dropdown) ----
export {
  listNotifications,
  type ListNotificationsResult,
  type NotificationView,
  type NotificationsUnauthorizedResult,
} from './server/list-notifications';
export { getUnreadCount, type UnreadCountResult } from './server/get-unread-count';
export {
  markNotificationRead,
  type MarkReadResult,
  type NotificationsInvalidInputResult,
} from './server/mark-read';
export { markAllNotificationsRead, type MarkAllReadResult } from './server/mark-all-read';

// ---- Preferences (Configurações → Notificações) ----
export {
  getNotificationPreferencesForOwner,
  type GetNotificationPreferencesResult,
} from './server/get-preferences';
export {
  updateNotificationPreferencesImpl,
  type UpdateNotificationPreferencesResult,
  type NotificationPreferencesView,
} from './server/update-preferences';

// ---- Pure presentation/validation helpers (lib) ----
export {
  markReadInputSchema,
  type MarkReadInput,
  notificationTypeSchema,
  type NotificationType,
  notificationTypeMeta,
  type NotificationTypeMeta,
  getNotificationTypeMeta,
} from './lib/schemas';
export {
  updateNotificationPreferencesInputSchema,
  type UpdateNotificationPreferencesInput,
} from './lib/preferences-schema';
export { formatNotificationTime } from './lib/relative-time';

// ---- Client components (bell + dropdown) ----
export { NotificationBell, type NotificationBellProps } from './components/notification-bell';
export {
  NotificationDropdown,
  type NotificationDropdownProps,
} from './components/notification-dropdown';
export {
  NotificationBellBoundary,
  type NotificationBellBoundaryProps,
} from './components/notification-bell-boundary';
