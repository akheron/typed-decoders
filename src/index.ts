export interface DecodeSuccess<T> {
  type: "success";
  value: T;
}

export interface DecodeFailure {
  type: "failure";
  error: string;
  decoderName: string;
  path: string;
}

export class DecodeError extends Error {
  constructor(
    error: string,
    public readonly decoderName: string,
    public readonly path: string
  ) {
    super(error);
  }
}

export type DecodeResult<T> = DecodeSuccess<T> | DecodeFailure;

export interface DecodeContext {
  parent?: DecodeContext;
  key: string | number;
}

const ROOT_CONTEXT = { key: "<root>" };

export interface Decoder<T> {
  name: string;
  decode(value: unknown, ctx: DecodeContext): DecodeResult<T>;
}

export type GetType<T> = T extends Decoder<infer U> ? U : never;

export function formatPath(context: DecodeContext): string {
  const res = [] as string[];
  while (context.parent !== undefined) {
    res.push(context.key.toString());
    context = context.parent;
  }
  res.reverse();
  return res.join(".");
}

export function error<T>(
  error: string,
  decoderName: string,
  ctx: DecodeContext
): DecodeResult<T> {
  const path = formatPath(ctx);
  return { type: "failure", error, decoderName, path };
}

export function ok<T>(value: T): DecodeResult<T> {
  return { type: "success", value };
}

export function isOk<T>(value: unknown): value is DecodeSuccess<T> {
  return (value as DecodeSuccess<T>).type === "success";
}

export function isError<T>(value: unknown): value is DecodeFailure {
  return (value as DecodeFailure).type === "failure";
}

export function context(parent: DecodeContext, key: string | number) {
  return { parent, key };
}

export type LiteralTypes = undefined | null | boolean | number | string;

const UnknownDecoder: Decoder<unknown> = {
  name: "Unknown",
  decode: function(value: unknown, ctx: DecodeContext) {
    return ok(value);
  }
};

const LiteralDecoder = <T extends LiteralTypes>(expect: T): Decoder<T> => {
  const name = "Literal";
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      if (value !== expect) {
        return error("expected_literal", name, ctx);
      }
      return ok(expect);
    }
  };
};

const StringDecoder: Decoder<string> = {
  name: "String",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<string> {
    if (typeof value !== "string") {
      return error("expected_string", StringDecoder.name, ctx);
    }
    return ok(value);
  }
};

const BooleanDecoder: Decoder<boolean> = {
  name: "Boolean",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<boolean> {
    if (typeof value !== "boolean") {
      return error("expected_boolean", BooleanDecoder.name, ctx);
    }
    return ok(value);
  }
};

const NumberDecoder: Decoder<number> = {
  name: "Number",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<number> {
    if (typeof value !== "number") {
      return error("expected_number", NumberDecoder.name, ctx);
    }
    return ok(value);
  }
};

const NumberStringDecoder: Decoder<number> = {
  name: "NumberString",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<number> {
    if (typeof value !== "string") {
      return error("expected_numberstring", NumberStringDecoder.name, ctx);
    }
    const res = parseFloat(value);
    if (isNaN(res)) {
      return error("expected_numberstring", NumberStringDecoder.name, ctx);
    }
    return ok(res);
  }
};

const DateDecoder: Decoder<Date> = {
  name: "Date",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<Date> {
    if (!(value instanceof Date)) {
      return error("expected_date", DateDecoder.name, ctx);
    }
    return ok(value);
  }
};

const DateStringDecoder: Decoder<Date> = {
  name: "DateString",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<Date> {
    if (typeof value !== "string") {
      return error("expected_datestring", DateStringDecoder.name, ctx);
    }
    const res = new Date(value);
    if (isNaN(res.getTime())) {
      return error("expected_datestring", DateStringDecoder.name, ctx);
    }
    return ok(res);
  }
};

const UndefinedDecoder: Decoder<undefined> = {
  name: "Undefined",
  decode: function(
    value: unknown,
    ctx: DecodeContext
  ): DecodeResult<undefined> {
    if (value !== undefined) {
      return error("expected_undefined", UndefinedDecoder.name, ctx);
    }
    return ok(value as undefined);
  }
};

const NullDecoder: Decoder<null> = {
  name: "Null",
  decode: function(value: unknown, ctx: DecodeContext): DecodeResult<null> {
    if (value !== null) {
      return error("expected_null", NullDecoder.name, ctx);
    }
    return ok(value as null);
  }
};

const TupleDecoder = <T extends any[]>(
  ...decoders: { [K in keyof T]: Decoder<T[K]> }
): Decoder<T> => {
  const name = `[${decoders.map(d => d.name).join(", ")}]`;
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      const result = ([] as unknown) as T;
      if (!Array.isArray(value)) {
        return error("expected_tuple", name, ctx);
      }
      for (let i = 0; i < decoders.length; i++) {
        const r = decoders[i].decode(value[i], context(ctx, i));
        if (isError(r)) {
          return r;
        }
        result[i] = r.value;
      }
      return ok(result);
    }
  };
};

const OptionalDecoder = <T>(decoder: Decoder<T>): Decoder<T | undefined> => {
  const name = `${decoder.name} | Undefined`;
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      if (value === undefined) {
        return ok(undefined);
      }
      return decoder.decode(value, ctx);
    }
  };
};

const ArrayDecoder = <T>(decoder: Decoder<T>): Decoder<T[]> => {
  const name = `${decoder.name}[]`;
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      if (!Array.isArray(value)) {
        return error("expected_array", name, ctx);
      }
      const res = [] as T[];
      for (let i = 0; i < value.length; i++) {
        const r = decoder.decode(value[i], context(ctx, i));
        if (isError(r)) {
          return r;
        }
        res.push(r.value);
      }
      return ok(res);
    }
  };
};

const RecordDecoder = <T>(
  fields: { [K in keyof T]: Decoder<T[K]> }
): Decoder<T> => {
  const name = `{ ${Object.keys(fields)
    .map(name => `${name}: ${fields[name as keyof T].name}`)
    .join(", ")} }`;
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      if (typeof value !== "object" || value === null) {
        return error("expected_object", name, ctx);
      }
      const keys = Object.keys(fields) as (keyof T)[];
      const res = {} as T;
      for (let i = 0; i < keys.length; i++) {
        const name = keys[i];
        const r = fields[name].decode(
          (value as any)[name],
          context(ctx, name as string)
        );
        if (isError(r)) {
          return r;
        }
        if (r.value !== undefined) {
          res[name] = r.value;
        }
      }
      return ok(res);
    }
  };
};

const UnionDecoder = <T extends any[]>(
  ...decoders: { [K in keyof T]: Decoder<T[K]> }
): Decoder<T[number]> => {
  const name = `${decoders.map(d => d.name).join(" | ")}`;
  return {
    name,
    decode: function(value: unknown, ctx: DecodeContext) {
      for (let i = 0; i < decoders.length; i++) {
        const r = decoders[i].decode(value, context(ctx, i));
        if (isOk(r)) {
          return r;
        }
      }
      return error("expected_union", name, ctx);
    }
  };
};

export const UnifyDecoder = <T extends any[], Z>(
  ...match: { [K in keyof T]: [Decoder<T[K]>, (value: T[K]) => Z] }
): Decoder<Z> => {
  const name = `(${match.map(d => d[0].name).join(" | ")}) => Z`;
  return {
    name,
    decode: (value: unknown, ctx: DecodeContext) => {
      for (let i = 0; i < match.length; i++) {
        const m = match[i];
        const r = m[0].decode(value, ROOT_CONTEXT);
        if (isOk(r)) return ok(m[1](r.value));
      }
      return error("expected_unify", name, ctx);
    }
  };
};

export function runDecoder<T>(
  decoder: Decoder<T>,
  value: unknown
): DecodeResult<T> {
  return decoder.decode(value, ROOT_CONTEXT);
}

export function runDecoderE<T>(decoder: Decoder<T>, value: unknown): T {
  const result = decoder.decode(value, ROOT_CONTEXT);
  if (isError(result)) {
    throw new DecodeError(result.error, result.decoderName, result.path);
  } else {
    return result.value;
  }
}

export const Decoders = {
  Literal: LiteralDecoder,
  String: StringDecoder,
  Boolean: BooleanDecoder,
  Number: NumberDecoder,
  NumberString: NumberStringDecoder,
  Undefined: UndefinedDecoder,
  Date: DateDecoder,
  DateString: DateStringDecoder,
  Null: NullDecoder,
  Unknown: UnknownDecoder,
  Optional: OptionalDecoder,
  Record: RecordDecoder,
  Array: ArrayDecoder,
  Tuple: TupleDecoder,
  Union: UnionDecoder,
  Unify: UnifyDecoder
};