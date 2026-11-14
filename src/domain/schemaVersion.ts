/** Version of the frozen user payload. The server accepts only this version. */
export const SCHEMA_VERSION = 1 as const

export type SchemaVersion = typeof SCHEMA_VERSION
