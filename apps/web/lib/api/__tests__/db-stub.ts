/**
 * Shared in-memory Supabase stub for route tests.
 *
 * Models the subset of the fluent client surface that route handlers actually
 * call. Callers `enqueue(table, result)` to register the next response per
 * table; the stub records every method invocation on `q.ops` so assertions
 * can verify the SQL intent without a real database.
 *
 * Limitations on purpose:
 *   - No simulation of real query semantics. Filters/ordering are recorded,
 *     not applied. The test caller is responsible for shaping `data`.
 *   - One stub per `from(table)` call. The route consumes them in order;
 *     tests must enqueue the same number of times the route calls `.from()`.
 */

export interface StubResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface RecordedOp {
  op: string;
  args: unknown[];
}

export class QueryStub {
  public ops: RecordedOp[] = [];
  public next: StubResult = { data: [], error: null };
  public table: string;
  constructor(table: string) {
    this.table = table;
  }
  private rec(op: string, ...args: unknown[]): this {
    this.ops.push({ op, args });
    return this;
  }
  select(cols?: string) {
    return this.rec("select", cols);
  }
  insert(payload: unknown) {
    return this.rec("insert", payload);
  }
  update(payload: unknown) {
    return this.rec("update", payload);
  }
  delete() {
    return this.rec("delete");
  }
  eq(c: string, v: unknown) {
    return this.rec("eq", c, v);
  }
  ilike(c: string, v: unknown) {
    return this.rec("ilike", c, v);
  }
  contains(c: string, v: unknown) {
    return this.rec("contains", c, v);
  }
  order(c: string, opts?: unknown) {
    return this.rec("order", c, opts);
  }
  limit(n: number) {
    return this.rec("limit", n);
  }
  lte(c: string, v: unknown) {
    return this.rec("lte", c, v);
  }
  gt(c: string, v: unknown) {
    return this.rec("gt", c, v);
  }
  or(expr: string) {
    return this.rec("or", expr);
  }
  in(c: string, v: unknown[]) {
    return this.rec("in", c, v);
  }
  gte(c: string, v: unknown) {
    return this.rec("gte", c, v);
  }
  lt(c: string, v: unknown) {
    return this.rec("lt", c, v);
  }
  single() {
    return Promise.resolve(this.next);
  }
  maybeSingle() {
    return Promise.resolve(this.next);
  }
  // The real Supabase query builder is thenable — `await query` resolves to
  // `{ data, error }` without needing `.single()` or `.maybeSingle()`. We
  // mirror that here so route code that uses the implicit thenable form still
  // works against the stub. Biome flags `then` on classes by default; opt-out
  // because thenability is the whole point of the stub.
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock
  then<R>(resolve: (r: StubResult) => R) {
    return Promise.resolve(this.next).then(resolve);
  }
}

export class DbStub {
  public stubs: QueryStub[] = [];
  public byTable = new Map<string, QueryStub[]>();
  public rpcCalls: { fn: string; args: unknown }[] = [];
  private rpcQueue = new Map<string, StubResult[]>();

  enqueue(table: string, result: StubResult): QueryStub {
    const q = new QueryStub(table);
    q.next = result;
    this.stubs.push(q);
    const list = this.byTable.get(table) ?? [];
    list.push(q);
    this.byTable.set(table, list);
    return q;
  }

  /** Queue the next response for a `db.rpc(fn, args)` call. */
  enqueueRpc(fn: string, result: StubResult): void {
    const list = this.rpcQueue.get(fn) ?? [];
    list.push(result);
    this.rpcQueue.set(fn, list);
  }

  /** Same `from(...)` shape Supabase exposes; pulls the next stub for the table. */
  from(table: string): QueryStub {
    const list = this.byTable.get(table) ?? [];
    const q = list.shift() ?? new QueryStub(table);
    return q;
  }

  /** Mirror of supabase.rpc(fnName, args) — returns the next queued result. */
  rpc(fn: string, args: unknown): Promise<StubResult> {
    this.rpcCalls.push({ fn, args });
    const list = this.rpcQueue.get(fn) ?? [];
    const next = list.shift();
    return Promise.resolve(next ?? { data: null, error: null });
  }

  /** All recorded ops across every consumed stub. Useful for assertions after the route returned. */
  allOps(): RecordedOp[] {
    return this.stubs.flatMap((s) => s.ops);
  }

  /** Recorded ops on stubs of a given table. */
  opsFor(table: string): RecordedOp[] {
    return this.stubs.filter((s) => s.table === table).flatMap((s) => s.ops);
  }
}
