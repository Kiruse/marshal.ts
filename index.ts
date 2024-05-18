export type Marshaller = ReturnType<typeof createMarshaller>;
export type MarshalCallback = (value: unknown, marshal: (value: unknown) => unknown) => MarshalResult<unknown>;
export type UnmarshalCallback<T> = (value: unknown, unmarshal: (value: unknown) => unknown) => MarshalResult<T>;
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
  (value, marshal) => Array.isArray(value) ? morph(value.map(v => marshal(v))) : pass,
  (value, unmarshal) => {
    if (!Array.isArray(value)) return pass;
    return morph(value.map(v => unmarshal(v)));
  }
);

export const RecaseMarshalUnit = (
  marshalCase: (key: string) => string,
  unmarshalCase: (key: string) => string,
) => defineMarshalUnit<unknown>(
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
  },
  true,
);

export const ObjectMarshalUnit = RecaseMarshalUnit(key => key, key => key);

export const SetMarshalUnit = defineMarshalUnit<Set<unknown>>(
  (value, marshal) => value instanceof Set ? morph({ $set: Array.from(value).map(v => marshal(v)) }) : pass,
  (value: any, unmarshal) => {
    if (typeof value !== 'object' || !Array.isArray(value?.$set)) return pass;
    return morph(new Set(value.$set.map((v: any) => unmarshal(v))));
  }
);

export const IgnoreMarshalUnit = (...types: Ctor[]) => defineMarshalUnit<unknown>(
  (value) => types.find(type => value instanceof type) ? morph(value) : pass,
  (value) => types.find(type => value instanceof type) ? morph(value) : pass,
);

export const ToJsonMarshalUnit = defineMarshalUnit<unknown>(
  (value: any, marshal) => value && typeof value.toJSON === 'function' ? morph(marshal(value.toJSON())) : pass,
  () => pass,
  true,
);

export function createMarshaller(units: Iterable<MarshalUnit>) {
  const self = { marshal, unmarshal, units };
  return self;

  function marshal(value: unknown): unknown {
    for (const unit of self.units) {
      if (unit.generic) continue;
      const result = unit.marshal(value, marshal);
      if (result.success) return result.value;
    }
    for (const unit of self.units) {
      if (!unit.generic) continue;
      const result = unit.marshal(value, marshal);
      if (result.success) return result.value;
    }
    return value;
  }

  function unmarshal(value: unknown): unknown {
    for (const unit of self.units) {
      if (unit.generic) continue;
      const result = unit.unmarshal(value, unmarshal);
      if (result.success) return result.value;
    }
    for (const unit of self.units) {
      if (!unit.generic) continue;
      const result = unit.unmarshal(value, unmarshal);
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
