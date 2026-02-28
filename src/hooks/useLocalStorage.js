import { useState, useCallback } from "react";

export function useLocalStorage(key, initialValue) {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.warn(error);
            return initialValue;
        }
    });

    const setValue = useCallback((value) => {
        setStoredValue((prevStoredValue) => {
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
