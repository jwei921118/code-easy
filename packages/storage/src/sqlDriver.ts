export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

export interface SqlDriver {
  migrate(): void;
  execute(sql: string, params?: SqlParams): void;
  query<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T[];
  queryOne<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): T | undefined;
  transaction<T>(action: () => T): T;
  close(): void;
}
