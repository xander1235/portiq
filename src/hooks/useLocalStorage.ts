import { useState, useCallback, Dispatch, SetStateAction } from "react";

export function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.warn(error);
            return initialValue;
        }
    });

    const setValue: Dispatch<SetStateAction<T>> = useCallback((value) => {
        setStoredValue((prevStoredValue: T) => {
            try {
                const valueToStore = value instanceof Function ? value(prevStoredValue) : value;
                window.localStorage.setItem(key, JSON.stringify(valueToStore));
                return valueToStore;
            } catch (error) {
                console.warn(error);
                return prevStoredValue;
            }
        });
    }, [key]);

    return [storedValue, setValue];
}
