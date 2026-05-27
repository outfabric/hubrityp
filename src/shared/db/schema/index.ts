// Barrel re-exporting every domain's tables for the Drizzle relational API
// and for queries. New domains MUST add their `tables` re-export here so the
// relational API can resolve cross-domain joins.
export * from './agenda/tables';
export * from './auth/tables';
export * from './health/tables';
export * from './notifications/tables';
export * from './patients/tables';
export * from './whatsapp/tables';
export * from './medical-records/tables';
export * from './telepsicologia/tables';
export * from './ai-transcription/tables';
export * from './rate-limits/tables';
