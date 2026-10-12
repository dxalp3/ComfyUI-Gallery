import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/** Keep each workspace view's state in memory; delayed setters retain their originating view. */
export function useViewState<T>(view: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
    const [fallback] = useState<T>(initial);
    const [values, setValues] = useState<Record<string, T>>({});
    const value = Object.prototype.hasOwnProperty.call(values, view) ? values[view] : fallback;
    const setValue = useCallback<Dispatch<SetStateAction<T>>>(update => {
        setValues(previous => {
            const old = Object.prototype.hasOwnProperty.call(previous, view) ? previous[view] : fallback;
            return { ...previous, [view]: typeof update === 'function' ? (update as (value: T) => T)(old) : update };
        });
    }, [view, fallback]);
    return [value, setValue];
}
