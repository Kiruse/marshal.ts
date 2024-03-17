export type Marshaller = (value: unknown, marshal: (value: unknown) => unknown) => MarshalResult<unknown>;
export type Unmarshaller<T> = (value: unknown, unmarshal: (value: unknown) => unknown) => MarshalResult<T>;

/** A shorthand constant to indicate an un/marshaller is passing on the given value. */
export const pass: MarshalResult<unknown> = ({ success: false });
/** A shorthand wrapper function to indicate an un/marshaller has processed the value, and what the processed value is. */
export const morph = <T>(value: T): MarshalResult<T> => ({ success: true, value });

export interface MarshalBundle<T> {
  marshal: Marshaller;
  unmarshal: Unmarshaller<T>;
}

export type MarshalResult<T> =
  | { success: true; value: T }
  | { success: false; };

/** Utility function to help define un/marshallers */
export const defineMarshaller = <T>(marshal: Marshaller, unmarshal: Unmarshaller<T>): MarshalBundle<T> => ({
  marshal,
  unmarshal,
});

export const DateMarshaller = defineMarshaller<Date>(
  (value) => value instanceof Date ? morph(value.toISOString()) : pass,
  (value) => {
    if (typeof value !== 'string') return pass;
    if (!value.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/)) return pass;
    const date = new Date(value);
    if (isNaN(date.valueOf())) return pass;
    return morph(date);
  }
);

export const BigintMarshaller = defineMarshaller<bigint>(
  (value) => typeof value === 'bigint' ? morph(value.toString()) : pass,
  (value) => {
    if (typeof value !== 'string' || !value.match(/^\d+$/)) return pass;
    return morph(BigInt(value));
  }
);

export const ArrayMarshaller = defineMarshaller<any[]>(
  (value, marshal) => Array.isArray(value) ? morph(value.map(v => marshal(v))) : pass,
  (value, unmarshal) => {
    if (!Array.isArray(value)) return pass;
    return morph(value.map(v => unmarshal(v)));
  }
);

export const RecaseMarshaller = (
  marshalCase: (key: string) => string,
  unmarshalCase: (key: string) => string,
) => defineMarshaller<unknown>(
  (value, marshal) => {
    if (typeof value !== 'object' || value === null) return pass;
    return morph(Object.fromEntries(
      Object.entries(value).map(([k, v]) => [marshalCase(k), marshal(v)])
    ));
  },
  (value, unmarshal) => {
    if (typeof value !== 'object' || value === null) return pass;
    return morph(Object.fromEntries(
      Object.entries(value).map(([k, v]) => [unmarshalCase(k), unmarshal(v)])
    ));
  }
);

export const ObjectMarshaller = RecaseMarshaller(key => key, key => key);

export const SetMarshaller = defineMarshaller<Set<unknown>>(
  (value, marshal) => value instanceof Set ? morph({ $set: Array.from(value).map(v => marshal(v)) }) : pass,
  (value: any, unmarshal) => {
    if (typeof value !== 'object' || !Array.isArray(value?.$set)) return pass;
    return morph(new Set(value.$set.map((v: any) => unmarshal(v))));
  }
);

export function createMarshal(...bundles: MarshalBundle<any>[]) {
  function marshal(value: unknown): unknown {
    for (const bundle of bundles) {
      const result = bundle.marshal(value, marshal);
      if (result.success) return result.value;
    }
    return value;
  }

  function unmarshal(value: unknown): unknown {
    for (const bundle of bundles) {
      const result = bundle.unmarshal(value, unmarshal);
      if (result.success) return result.value;
    }
    return value;
  }

  return { marshal, unmarshal };
}

createMarshal.withDefault = (...bundles: MarshalBundle<any>[]) => createMarshal(
  ArrayMarshaller,
  BigintMarshaller,
  DateMarshaller,
  ...bundles,
  SetMarshaller,
  ObjectMarshaller,
);

const { marshal, unmarshal } = createMarshal.withDefault();
export { marshal, unmarshal };
