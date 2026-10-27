import type { DatabaseSync } from 'node:sqlite';

export type FieldType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'json' | 'blob';

export interface FieldSpec {
  type?: FieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
}

export type Schema = Record<string, FieldType | FieldSpec>;

export interface ModelOptions {
  /** Adds `createdAt` / `updatedAt` columns and keeps them up to date. */
  timestamps?: boolean;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type TypeOf<T extends FieldType> =
  T extends 'string' | 'text' ? string :
  T extends 'number' | 'integer' ? number :
  T extends 'boolean' ? boolean :
  T extends 'date' ? Date :
  T extends 'json' ? JsonValue :
  T extends 'blob' ? Uint8Array :
  unknown;

type SpecType<S> = S extends FieldType ? S : S extends { type: infer T extends FieldType } ? T : 'string';

type Timestamps<O> = O extends { timestamps: true } ? { createdAt: Date; updatedAt: Date } : {};

/** The row type a schema produces: `id` plus every declared field (nullable unless `required`). */
export type InferRow<S extends Schema, O extends ModelOptions = {}> = { id: number } & {
  [K in keyof S]: S[K] extends { required: true } ? TypeOf<SpecType<S[K]>> : TypeOf<SpecType<S[K]>> | null;
} & Timestamps<O>;

export interface Operators<V> {
  $eq?: V | null;
  $ne?: V | null;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $nin?: V[];
  $like?: string;
}

export type Conditions<Row> = {
  [K in keyof Row]?: Row[K] | null | Row[K][] | Operators<NonNullable<Row[K]>>;
};

export type SortDirection = 1 | -1 | 'asc' | 'desc';

export interface FindOptions<Row> {
  /** `'-createdAt name'` or `{ createdAt: -1, name: 1 }` */
  sort?: string | { [K in keyof Row]?: SortDirection };
  limit?: number;
  offset?: number;
}

export type Insert<Row> = Partial<Omit<Row, 'id'>> & { id?: number };

export declare class Model<Row extends Record<string, any> = Record<string, any>> {
  readonly table: string;
  find(conditions?: Conditions<Row>, options?: FindOptions<Row>): Row[];
  findOne(conditions?: Conditions<Row>, options?: FindOptions<Row>): Row | null;
  findById(id: number): Row | null;
  create(data?: Insert<Row>): Row;
  createMany(list: Insert<Row>[]): Row[];
  /** Throws when `conditions` is empty. */
  update(conditions: Conditions<Row>, data: Partial<Row>): Row[];
  updateById(id: number, data: Partial<Row>): Row | null;
  /** Throws when `conditions` is empty. */
  delete(conditions: Conditions<Row>): Row[];
  deleteById(id: number): Row | null;
  count(conditions?: Conditions<Row>): number;
  exists(conditions?: Conditions<Row>): boolean;
}

export type Params = unknown[] | Record<string, unknown> | string | number | bigint | boolean | Date | Uint8Array | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

export interface ConnectOptions {
  /** WAL journal mode. Default: `true` for files, `false` for `:memory:` and read-only. */
  wal?: boolean;
  /** Default: `true` */
  foreignKeys?: boolean;
  /** Milliseconds to wait on a locked database. Default: `5000` */
  busyTimeout?: number;
  readOnly?: boolean;
  logger?: Logger;
}

export interface SqliteLight {
  model<S extends Schema, O extends ModelOptions = {}>(table: string, schema: S, options?: O): Model<InferRow<S, O>>;
  model<Row extends Record<string, any> = Record<string, any>>(table: string): Model<Row>;
  query<Row = Record<string, unknown>>(sql: string, params?: Params): Row[];
  get<Row = Record<string, unknown>>(sql: string, params?: Params): Row | null;
  run(sql: string, params?: Params): RunResult;
  exec(sql: string): this;
  /** `fn` must be synchronous. Rolls back if it throws; nested calls use savepoints. */
  transaction<T>(fn: (db: this) => T): T;
  close(): void;
  readonly raw: DatabaseSync;
}

export declare function connectDB(path?: string, options?: ConnectOptions): SqliteLight;

export { DatabaseSync };
