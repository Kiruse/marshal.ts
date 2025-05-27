# @kiruse/marshal
> *Marshalling* or *marshaling* (US spelling) is the process of transforming the memory representation of an object into a data format suitable for storage or transmission.

In JavaScript, a "data format suitable for storage or transmission" is a *Plain Old JavaScript Object* (POJO) which can be easily serialized in JSON or YAML. This library helps convert runtime objects to and from a JSON object.

While the built-in JSON library supports the `.toJSON()` method, you can only revert this process with a custom reviver in your `JSON.parse` call. `@kiruse/marshal` offers an extensible & reusable alternative where both marshallers & their corresponding unmarshallers are defined physically nearby. Further, `.toJSON()` can only be added on your own types (unless you monkeypatch a foreign type) whereas marshalling & unmarshalling works on any type.

## Usage
**Note** that un/marshalling, as a part of I/O operations, cannot reliably recreate your underlying data types without extensive assertions or other assumptions (e.g. the format did not change between program executions). Thus, both `marshal` and `unmarshal` functions intentionally return an `unknown` to require deliberacy on your part.

Using the standard marshallers is simple:
```typescript
import { marshal, unmarshal } from '@kiruse/marshal';
import fs from 'fs/promises';
import { expect } from 'jest';

const ref = {
  foo: 'bar',
  baz: {
    n: 123456n,
    set: new Set([1, 2, 3])
  },
};

await fs.writeFile('tmp.json', JSON.stringify(marshal(ref)));

const act = unmarshal(await fs.readFile('tmp.json', 'utf8'));
expect(act).toEqual(ref);
```

You can add custom marshallers as well:
```typescript
import {
  defineMarshalUnit,
  extendDefaultMarshaller,
  morph,
  pass,
} from '@kiruse/marshal';
import { expect } from 'jest';

class MyType {
  constructor(public readonly foo: string) {}
}

const { marshal, unmarshal, morph, pass } = extendDefaultMarshaller([
  defineMarshalUnit<MyType>(
    (value, marshal) => value instanceof MyType
      ? morph(marshal({ $foo: value.foo }))
      : pass,
    (value, unmarshal) => typeof value === 'object' && '$foo' in value
      ? morph(new MyType(value.$foo))
      : pass,
  ),
]);

const act = unmarshal(marshal(new MyType('bar')));
expect(act).toBeInstanceOf(MyType);
expect(act).toEqual(new MyType('bar'));
```
The generic parameter passed to `defineMarshal` is only intended to help you return the proper types from the `unmarshal` callback.

You can recase objects e.g. for transmission over the wire to a server which expects a different casing than the typical casing convention for your language by creating a custom marshaller involving the `RecaseMarshaller`:
```typescript
import { createMarshal, morph, pass, RecaseMarshaller } from '@kiruse/marshal';
import { expect } from 'jest';
import { toSnakeCase, toCamelCase } from './util'; // assumed to exist

const { marshal, unmarshal } = extendDefaultMarshaller([
  RecaseMarshaller(
    key => toSnakeCase(key),
    key => toCamelCase(key),
  ),
]);

const ref = {
  fooBarBaz: 'quux',
};

expect(marshal(ref)).toEqual({ foo_bar_baz: 'quux' });
expect(unmarshal(marshal(ref))).toEqual(ref);
```

### `.toJSON()` Support
This library provides a default Marshal Unit to support the `.toJSON()` method supported by `JSON.stringify` as well. However, just like `JSON.stringify`, it is unable to unmarshal such an object. `.toJSON()` is a one-way road. If you need to support reconstructing objects serialized with `.toJSON()`, it is better to build a custom marshaller or marshal unit.

## Marshal Units & Marshallers
This library distinguishes between *Marshal Units* and `Marshaller`s.

- *Marshal Units* are composable pairs of `marshal`/`unmarshal` methods which are supposed to deal with only one specific type or format of data.
- `Marshaller`s are sets of *marshal units* stringing them together. A `Marshaller` will iterate over all its units and pass them the value to marshal.

A *marshal unit* receives all values from its `Marshaller`, but is expected to handle only the ones it is concerned with. If it doesn't handle a value, it should return `pass`. It it does handle a value, it should return `morph(<new_value>)`.

The `Marshaller` will return the first `morph`ed value if any, or otherwise the original value if no *marshal unit* applied.

Following are the `BigintMarshalUnit` and `DateMarshalUnit` as defined in this library:

```typescript
import {
  defineMarshalUnit,
  morph,
  pass,
} from '@kiruse/marshal';

export const BigintMarshalUnit = defineMarshalUnit<bigint>(
  (value) => typeof value === 'bigint' ? morph(value.toString()) : pass,
  (value) => {
    if (typeof value !== 'string' || !value.match(/^\d+$/)) return pass;
    return morph(BigInt(value));
  }
);

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
```

### Passback Method
*Marshal Units* differ from `Marshaller`s in that their `marshal`/`unmarshal` methods take one additional argument: the *passback method*, which is the `marshal`/`unmarshal` method of the respective calling `Marshaller`. If your `morph`ed object contains other non-trivial properties such as a `Date`, you can pass it to this method in order to let the `Marshaller` decide how to handle that value.

Following are the `ArrayMarshalUnit` and `ObjectMarshalUnit` implementations of this library:

```typescript
import {
  defineMarshalUnit,
  morph,
  pass,
} from '@kiruse/marshal';

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
  true, // this is a generic marshal unit - see below
);

export const ObjectMarshalUnit = RecaseMarshalUnit(key => key, key => key);****
```

### Generic Units
The library currently ships with only one generic marshalling unit: the `RecaseMarshalUnit` (the `ObjectMarshalUnit` is a specialization of this unit which simply doesn't recase keys). Because this unit is essentially designed to post-process every single object, it is probably not best suited to handle specific objects such as `Date`s or `Set`s.

`defineMarshalUnit` takes an optional 3rd argument `generic` which defaults to `false`. When set, the `Marshaller` will run this unit after non-generic units. This applies dynamically to combined marshallers as well.

## Extending & Combining Marshallers
The core idea of this library is to streamline the integration of arbitrary data types with arbitrary persistency systems. To accomplish this, library developers are instructed to follow 2 patterns:

1. Every persisting type have its own *Marshal Unit* created with `defineMarshalUnit`, and
2. All types of your library should be combined into one `Marshaller` using `createMarshaller`.

The first pattern allows consumers of your library to compose their own marshallers using your types - possibly providing their own overrides and ordering - whilst the second allows them to simply reuse your `Marshaller` for basic needs.

The `combineMarshallers` method can be used to combine one or more `Marshaller`:

```typescript
import { combineMarshallers, defaultMarshaller } from '@kiruse/marshal';
import { LibAMarshaller } from 'lib-a';
import { LibBMarshaller } from 'lib-b';

const marshaller = combineMarshallers(
  LibAMarshaller,
  LibBMarshaller,
  defaultMarshaller,
);
```

In this snippet, the new `marshaller` returns the first `morph`ed value from the sequential combination of all 3 marshallers. It will first iterate through `LibAMarshaller`, then `LibBMarshaller`, and finally through `defaultMarshaller`. Further, it will first iterate over all non-`generic` marshal units (i.e. *specific units*) across all 3 marshallers, then over all of their *generic marshal units*.

## Key-based Un/Marshalling
The second argument passed to a marshal unit's `marshal` & `unmarshal` methods is the context object. This context object exposes the `marshal` and `unmarshal` methods which allow you to send an arbitrary value through the entire pipeline. But it also exposes the `key` property which tells you which key of the parent object we are currently un/marshalling. This is especially useful for unmarshalling when keys are marked accordingly, e.g. using a prefix or suffix. For example:

```ts
import { defineMarshalUnit, morph, pass } from '@kiruse/marshal';

const CustomDateMarshalUnit = defineMarshalUnit(
  (value: any) => value instanceof Date ? morph(value.valueOf()) : pass,
  (value: any, { key }) => typeof key === 'string' && key.endsWith('Time') ? morph(new Date(Number(value))) : pass,
);
```
