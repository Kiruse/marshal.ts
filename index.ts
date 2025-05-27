export type Marshaller = ReturnType<typeof createMarshaller>;
export type MarshalCallback = (value: unknown, ctx: MarshalUnitContext) => MarshalResult<unknown>;
export type UnmarshalCallback<T> = (value: unknown, ctx: MarshalUnitContext) => MarshalResult<T>;
type Ctor<Args extends any[] = any[], T = any> = new (...args: Args) => T;

/** A shorthand constant to indicate an un/marshaller is passing on the given value. */
export const pass: MarshalResult<any> = ({ success: false });
/** A shorthand wrapper function to indicate an un/marshaller has processed the value, and what the processed value is. */
export const morph = <T>(value: T): MarshalResult<T> => ({ success: true, value });

export interface MarshalUnit<T = any> {
  marshal: MarshalCallback;
  unmarshal: UnmarshalCallback<T>;
  generic: boolean;
}

export interface MarshalUnitContext {
  /** A loopback to pass values back through the entire current marshalling pipeline. */
  marshal: (value: unknown, key?: string | number | null) => unknown;
  /** A loopback to pass values back through the entire current unmarshalling pipeline. */
  unmarshal: (value: unknown, key?: string | number | null) => unknown;
  /** The key of the current property or index that is being un/marshalled, or null if it is the root object/value. */
  key: string | number | null;
}

export type MarshalResult<T> =
  | { success: true; value: T }
  | { success: false; };

/** Utility function to help define marshal units.
 *
 * Example:
 *
 * ```typescript
 * import { defineMarshalUnit, morph, pass } from '@kiruse/marshal';
 *
 * const MyMarshalUnit = defineMarshalUnit(
 *   (value) => value instanceof Foo ? morph(value.toString()) : pass,
 *   (value) => typeof value === 'string' && MyClass.isSerialized(value) ? morph(MyClass.fromString(value)) : pass,
 * );
 * ```
 *
 * An optional `generic` argument can be passed to indicate that the marshaller unit is generic and
 * handles a broad spectrum of types. Generic units are treated with lower priority than specific
 * ones. When combining marshallers, generic units are run after specific units of all marshallers.
 */
export const defineMarshalUnit = <T>(marshal: MarshalCallback, unmarshal: UnmarshalCallback<T>, generic = false): MarshalUnit<T> => ({
  marshal,
  unmarshal,
  generic,
});

export const DateMarshalUnit = defineMarshalUnit<Date>(
  (value) => value instanceof Date ? morph(value.toISOString()) : pass,
  (value) => {
    if (typeof value !== 'string') return pass;
    if (!value.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/)) return pass;
    const date = new Date(value);
    if (isNaN(date.valueOf())) return pass;
    return morph(date);
  }
);

export const BigintMarshalUnit = defineMarshalUnit<bigint>(
  (value) => typeof value === 'bigint' ? morph(value.toString()) : pass,
  (value) => {
    if (typeof value !== 'string' || !value.match(/^\d+$/)) return pass;
    return morph(BigInt(value));
  }
);

export const ArrayMarshalUnit = defineMarshalUnit<any[]>(
  (value, { marshal }) => Array.isArray(value) ? morph(value.map((v, i) => marshal(v, i))) : pass,
  (value, { unmarshal }) => {
    if (!Array.isArray(value)) return pass;
    return morph(value.map((v, i) => unmarshal(v, i)));
  }
);

export const RecaseMarshalUnit = (
  marshalCase: (key: string) => string,
  unmarshalCase: (key: string) => string,
) => defineMarshalUnit<unknown>(
  (value, { marshal, key }) => {
    if (typeof value !== 'object' || value === null) return pass;
    let changed = false;
    const result = Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const newKey = marshalCase(k);
        if (newKey === k) return [k, v];
        changed = true;
        return [newKey, v];
      }),
    );
    return changed ? morph(marshal(result, key)) : pass;
  },
  (value, { unmarshal, key }) => {
    if (typeof value !== 'object' || value === null) return pass;
    let changed = false;
    const result = Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const newKey = unmarshalCase(k);
        if (newKey === k) return [k, v];
        changed = true;
        return [newKey, v];
      }),
    );
    return changed ? morph(unmarshal(result, key)) : pass;
  },
  true,
);

export const ObjectMarshalUnit = defineMarshalUnit(
  (value, { marshal }) => typeof value === 'object' && value !== null ? morph(
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, marshal(v, k)]))
  ) : pass,
  (value, { unmarshal }) => typeof value === 'object' && value !== null ? morph(
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmarshal(v, k)]))
  ) : pass,
  true,
);

export const SetMarshalUnit = defineMarshalUnit<Set<unknown>>(
  (value, { marshal }) => value instanceof Set ? morph({ $set: Array.from(value).map((v, i) => marshal(v, i)) }) : pass,
  (value: any, { unmarshal }) => {
    if (typeof value !== 'object' || !Array.isArray(value?.$set)) return pass;
    return morph(new Set(value.$set.map((v: any, i: number) => unmarshal(v, i))));
  }
);

export const IgnoreMarshalUnit = (...types: Ctor[]) => defineMarshalUnit<unknown>(
  (value) => types.find(type => value instanceof type) ? morph(value) : pass,
  (value) => types.find(type => value instanceof type) ? morph(value) : pass,
);

export const ToJsonMarshalUnit = defineMarshalUnit<unknown>(
  (value: any, { marshal, key }) => value && typeof value.toJSON === 'function' ? morph(marshal(value.toJSON(), key)) : pass,
  () => pass,
  true,
);

export function createMarshaller(units: Iterable<MarshalUnit>) {
  const self = { marshal, unmarshal, units };
  return self;

  function marshal(value: unknown, key: string | number | null = null): unknown {
    for (const unit of self.units) {
      if (unit.generic) continue;
      const result = unit.marshal(value, { marshal, unmarshal, key });
      if (result.success) return result.value;
    }
    for (const unit of self.units) {
      if (!unit.generic) continue;
      const result = unit.marshal(value, { marshal, unmarshal, key });
      if (result.success) return result.value;
    }
    return value;
  }

  function unmarshal(value: unknown, key: string | number | null = null): unknown {
    for (const unit of self.units) {
      if (unit.generic) continue;
      const result = unit.unmarshal(value, { marshal, unmarshal, key });
      if (result.success) return result.value;
    }
    for (const unit of self.units) {
      if (!unit.generic) continue;
      const result = unit.unmarshal(value, { marshal, unmarshal, key });
      if (result.success) return result.value;
    }
    return value;
  }
}

export const combineMarshallers = (...marshallers: Marshaller[]) => createMarshaller({
  [Symbol.iterator]: function* () {
    for (const marshaller of marshallers) yield* marshaller.units;
  },
});

export const extendMarshaller = (base: Marshaller, units: Iterable<MarshalUnit>) =>
  combineMarshallers(createMarshaller(units), base);

export const extendDefaultMarshaller = (units: Iterable<MarshalUnit>) =>
  extendMarshaller(defaultMarshaller, units);

/** Utility function to add a finalizer to a marshaller.
 *
 * The finalizer is a function that is called after the marshaller has unmarshalled a value and can
 * be used to perform any final transformations on the value. This is particularly useful for
 * restoring values that cannot be reliably detected, such as base64 encoded byte arrays.
 */
export const addMarshallerFinalizer = <T>(base: Marshaller, finalizer: (value: any) => T): Marshaller => ({
  marshal: (value) => base.marshal(value),
  unmarshal: (value) => finalizer(base.unmarshal(value)),
  units: base.units,
});

export const defaultMarshalUnits = [
  ArrayMarshalUnit,
  BigintMarshalUnit,
  DateMarshalUnit,
  SetMarshalUnit,
  ToJsonMarshalUnit,
  ObjectMarshalUnit,
];

export const defaultMarshaller = createMarshaller(defaultMarshalUnits);
export const marshal = defaultMarshaller.marshal;
export const unmarshal = defaultMarshaller.unmarshal;
