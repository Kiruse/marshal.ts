import { describe, expect, test } from 'bun:test';
import { DateTime } from 'luxon';
import {
  BigintMarshalUnit, createMarshaller, DateMarshalUnit, defineMarshalUnit, extendDefaultMarshaller,
  extendMarshaller, IgnoreMarshalUnit, marshal, MarshalUnit, morph, pass, RecaseMarshalUnit,
  SetMarshalUnit, unmarshal
} from './index';

const KeyTestMarshalUnit = defineMarshalUnit(
  (value, { key }) => value instanceof Date ? morph(value.valueOf()) : pass,
  (value, { key }) => typeof key === 'string' && key.endsWith('Time') ? morph(new Date(+(value as any))) : pass,
);

describe('marshal.ts', () => {
  test('Default Marshallers', () => {
    const date = new Date('2021-01-01');
    expect(unmarshal(marshal(123456n))).toBe(123456n);
    expect(unmarshal(marshal(date))).toEqual(date);
    expect(unmarshal(marshal([1, 2n, date]))).toEqual([1, 2n, date]);
    expect(unmarshal(marshal(new Set([1, 2, 3])))).toEqual(new Set([1, 2, 3, 1]));
    expect(unmarshal(marshal({ foo: 'bar', baz: 123n, set: new Set([1, 2, 3]) }))).toEqual({ foo: 'bar', baz: 123n, set: new Set([1, 2, 3]) });
  });

  test('toJSON Marshaller', () => {
    class Foo {
      #value: string;
      constructor(value: string) {
        this.#value = value;
      }
      toJSON() {
        return { value: this.#value };
      }
    }

    expect(marshal(new Foo('bar'))).toEqual({ value: 'bar' });
    // unmarshal not supported as toJSON is considered a one-way road
  });

  test('Custom Marshallers', () => {
    const { marshal, unmarshal } = extendDefaultMarshaller([
      defineMarshalUnit(
        (value) => typeof value === 'string' && value === 'foo' ? morph('bar') : pass,
        (value) => typeof value === 'string' && value === 'bar' ? morph('foo') : pass
      ),
    ]);
    expect(marshal('foo')).toBe('bar');
    expect(unmarshal(marshal('foo'))).toBe('foo');
    expect(marshal({ foo: 'foo' })).toEqual({ foo: 'bar' });
    expect(unmarshal(marshal({ foo: 'foo' }))).toEqual({ foo: 'foo' });
  });

  test('Dynamically Extended Custom Marshallers', () => {
    const baseUnits = [BigintMarshalUnit] as MarshalUnit[];
    const { marshal, unmarshal } = extendMarshaller(
      createMarshaller(baseUnits),
      [SetMarshalUnit],
    );

    const date = new Date('2021-01-01');
    const set  = new Set([1, 2, 3]);
    expect(marshal(date)).toBe(date);
    expect(unmarshal(marshal(set))).toEqual(set);

    baseUnits.push(DateMarshalUnit);
    expect(marshal(date)).toBe('2021-01-01T00:00:00.000Z');
    expect(unmarshal(marshal(set))).toEqual(set);
  });

  test('Recasing Marshal', () => {
    const { marshal, unmarshal } = extendDefaultMarshaller([
      RecaseMarshalUnit(
        key => key.replace(/([A-Z])/g, '_$1').toLowerCase(),
        key => key.replace(/_(.)/g, (_, c) => c.toUpperCase()),
      ),
    ]);
    expect(marshal({ fooBar: 'baz' })).toEqual({ foo_bar: 'baz' });
    expect(unmarshal(marshal({ fooBar: 'baz' }))).toEqual({ fooBar: 'baz' });
  });

  test('Ignore Marshal', () => {
    class Foo {
      bar = 'baz';
    }

    const { marshal, unmarshal } = extendDefaultMarshaller([IgnoreMarshalUnit(Foo)]);
    expect(marshal(new Foo())).toBeInstanceOf(Foo);
    expect(unmarshal(marshal(new Foo()))).toBeInstanceOf(Foo);
  });

  test('Un/marshal with Key', () => {
    const { marshal, unmarshal } = extendDefaultMarshaller([KeyTestMarshalUnit]);

    const startTime = DateTime.now().startOf('day').toJSDate();
    const endTime = DateTime.now().endOf('day').toJSDate();

    const marshalled: any = marshal({ startTime, endTime });
    const unmarshalled: any = unmarshal(marshalled);

    expect(marshalled.startTime).toBeNumber()
    expect(marshalled.endTime).toBeNumber();

    expect(unmarshalled).toEqual({ startTime, endTime });
    expect(unmarshalled.startTime).toBeInstanceOf(Date);
    expect(unmarshalled.endTime).toBeInstanceOf(Date);
  });
});
