import React from 'react';

type TextInputElement = HTMLInputElement | HTMLTextAreaElement;
type TextInputChangeEvent = React.ChangeEvent<TextInputElement>;
type TextInputCompositionEvent = React.CompositionEvent<TextInputElement>;

type ImeSafeTextOptions = {
  maxLength?: number;
};

const areStringArraysEqual = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

export function useImeSafeTextValue(
  value: string,
  commit: (value: string) => void,
  options: ImeSafeTextOptions = {},
) {
  const { maxLength } = options;
  const [draft, setDraft] = React.useState(value);
  const isComposingRef = React.useRef(false);

  const normalizeValue = React.useCallback(
    (next: string) =>
      typeof maxLength === 'number' ? next.slice(0, maxLength) : next,
    [maxLength],
  );

  React.useEffect(() => {
    if (isComposingRef.current) return;
    setDraft((prev) => (prev === value ? prev : value));
  }, [value]);

  const onChange = React.useCallback(
    (event: TextInputChangeEvent) => {
      const next = normalizeValue(event.target.value);
      const nativeEvent = event.nativeEvent as InputEvent & {
        isComposing?: boolean;
      };
      setDraft(next);
      if (!isComposingRef.current && !nativeEvent.isComposing) {
        commit(next);
      }
    },
    [commit, normalizeValue],
  );

  const onCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const onCompositionEnd = React.useCallback(
    (event: TextInputCompositionEvent) => {
      isComposingRef.current = false;
      const next = normalizeValue(event.currentTarget.value);
      setDraft(next);
      commit(next);
    },
    [commit, normalizeValue],
  );

  return {
    value: draft,
    onChange,
    onCompositionStart,
    onCompositionEnd,
    isComposingRef,
  };
}

export function useImeSafeTextList(
  values: readonly string[],
  commit: (index: number, value: string) => void,
  options: ImeSafeTextOptions = {},
) {
  const { maxLength } = options;
  const [drafts, setDrafts] = React.useState<string[]>(() => Array.from(values));
  const composingIndexesRef = React.useRef<Set<number>>(new Set());

  const normalizeValue = React.useCallback(
    (next: string) =>
      typeof maxLength === 'number' ? next.slice(0, maxLength) : next,
    [maxLength],
  );

  React.useEffect(() => {
    if (composingIndexesRef.current.size > 0) return;
    setDrafts((prev) =>
      areStringArraysEqual(prev, values) ? prev : Array.from(values),
    );
  }, [values]);

  const setDraftAt = React.useCallback(
    (index: number, value: string) => {
      setDrafts((prev) => {
        const next =
          prev.length === values.length ? [...prev] : Array.from(values);
        next[index] = value;
        return next;
      });
    },
    [values],
  );

  const bind = React.useCallback(
    (index: number) => {
      const onChange = (event: TextInputChangeEvent) => {
        const next = normalizeValue(event.target.value);
        const nativeEvent = event.nativeEvent as InputEvent & {
          isComposing?: boolean;
        };
        setDraftAt(index, next);
        if (
          !composingIndexesRef.current.has(index) &&
          !nativeEvent.isComposing
        ) {
          commit(index, next);
        }
      };

      const onCompositionStart = () => {
        composingIndexesRef.current.add(index);
      };

      const onCompositionEnd = (event: TextInputCompositionEvent) => {
        composingIndexesRef.current.delete(index);
        const next = normalizeValue(event.currentTarget.value);
        setDraftAt(index, next);
        commit(index, next);
      };

      return {
        value: drafts[index] ?? values[index] ?? '',
        onChange,
        onCompositionStart,
        onCompositionEnd,
      };
    },
    [commit, drafts, normalizeValue, setDraftAt, values],
  );

  return {
    values: drafts,
    bind,
    composingIndexesRef,
  };
}
