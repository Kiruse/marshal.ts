# @kiruse/marshal
> *Marshalling* or *marshaling* (US spelling) is the process of transforming the memory representation of an object into a data format suitable for storage or transmission.

In JavaScript, a "data format suitable for storage or transmission" is a *Plain Old JavaScript Object* (POJO) which can be easily serialized in JSON or YAML. This library helps convert runtime objects to and from a JSON object.

While the built-in JSON library supports the `.toJSON()` method, you can only revert this process with a custom reviver in your `JSON.parse` call. `@kiruse/marshal` offers an extensible & reusable alternative where both marshallers & their corresponding unmarshallers are defined physically nearby. Further, you `.toJSON()` can only be added on your own types (unless you monkeypatch a foreign type) whereas marshalling & unmarshalling works on any type.

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
import { createMarshal, morph, pass } from '@kiruse/marshal';
import { expect } from 'jest';

class MyType {
  constructor(public readonly foo: string) {}
}

const { marshal, unmarshal, morph, pass } = createMarshal.withDefault(
  defineMarshaller<MyType>(
    (value, marshal) => value instanceof MyType
      ? morph(marshal({ $foo: value.foo }))
      : pass,
    (value, unmarshal) => typeof value === 'object' && '$foo' in value
      ? morph(new MyType(value.$foo))
      : pass,
  ),
);

const act = unmarshal(marshal(new MyType('bar')));
expect(act).toBeInstanceOf(MyType);
expect(act).toEqual(new MyType('bar'));
```
The generic parameter passed to `defineMarshaller` is only intended to help you return the proper types from the `unmarshal` callback.

You can recase objects e.g. for transmission over the wire to a server which expects a different casing than the typical casing convention for your language by creating a custom marshaller involving the `RecaseMarshaller`:
```typescript
import { createMarshal, morph, pass, RecaseMarshaller } from '@kiruse/marshal';
import { expect } from 'jest';
import { toSnakeCase, toCamelCase } from './util'; // assumed to exist

const { marshal, unmarshal } = createMarshal.withDefault(
  RecaseMarshaller(
    key => toSnakeCase(key),
    key => toCamelCase(key),
  ),
);

const ref = {
  fooBarBaz: 'quux',
};

expect(marshal(ref)).toEqual({ foo_bar_baz: 'quux' });
expect(unmarshal(marshal(ref))).toEqual(ref);
```

The `createMarshal` method is the even more generic factory of its `createMarshal.withDefault` variant. `withDefault` adds your custom marshallers into the blend of existing marshallers whilst `createMarshal` only uses your custom marshallers. Of course, the `createMarshal` and `createMarshal.withDefault` methods take variadic arguments to allow you to specify multiple custom marshallers.