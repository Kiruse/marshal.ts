import { describe, expect, test } from 'bun:test';
import { RecaseMarshaller, createMarshal, defineMarshaller, marshal, morph, pass, unmarshal } from './index';

describe('marshal.ts', () => {
  test('Default Marshallers', () => {
    const date = new Date('2021-01-01');
    expect(unmarshal(marshal(123456n))).toBe(123456n);
    expect(unmarshal(marshal(date))).toEqual(date);
    expect(unmarshal(marshal([1, 2n, date]))).toEqual([1, 2n, date]);
    expect(unmarshal(marshal(new Set([1, 2, 3])))).toEqual(new Set([1, 2, 3, 1]));
    expect(unmarshal(marshal({ foo: 'bar', baz: 123n, set: new Set([1, 2, 3]) }))).toEqual({ foo: 'bar', baz: 123n, set: new Set([1, 2, 3]) });
  });

  test('Custom Marshallers', () => {
    const { marshal, unmarshal } = createMarshal.withDefault(
      defineMarshaller(
        (value) => typeof value === 'string' && value === 'foo' ? morph('bar') : pass,
        (value) => typeof value === 'string' && value === 'bar' ? morph('foo') : pass
      ),
    );
    expect(marshal('foo')).toBe('bar');
    expect(unmarshal(marshal('foo'))).toBe('foo');
    expect(marshal({ foo: 'foo' })).toEqual({ foo: 'bar' });
    expect(unmarshal(marshal({ foo: 'foo' }))).toEqual({ foo: 'foo' });
  });

  test('Recasing Marshal', () => {
    const { marshal, unmarshal } = createMarshal.withDefault(
      RecaseMarshaller(
        key => key.replace(/([A-Z])/g, '_$1').toLowerCase(),
        key => key.replace(/_(.)/g, (_, c) => c.toUpperCase()),
      ),
    );
    expect(marshal({ fooBar: 'baz' })).toEqual({ foo_bar: 'baz' });
    expect(unmarshal(marshal({ fooBar: 'baz' }))).toEqual({ fooBar: 'baz' });
  })
});
