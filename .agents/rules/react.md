---
trigger: always_on
---

React Frontend Rules: Strict useEffect Policy

Core Philosophy
We follow a strict "No useEffect" policy for application logic. useEffect is reserved exclusively for synchronizing with external non-React systems (Browser APIs, analytics, third-party widgets).

The Rules
1. ABSOLUTELY NO useEffect for the following:
Data Fetching: Do not use useEffect to fetch data on mount. Use React Query, SWR, or Server Components/Server Actions.
Derived State: Do not use useEffect to update state based on other state changes.
Wrong: useEffect(() => setName(first + last), [first, last])
Right: const name = first + last; (Calculate during render)
Event Handling: Do not use useEffect to respond to user actions triggered by state changes.
Wrong: Set state isSuccess, then useEffect to show toast.
Right: Call toast.show() directly inside the onSubmit handler.
2. The ONLY Exception: Synchronizing External Systems
If you must interact with an external system on mount (e.g., setting up a WebSocket connection, adding a window resize listener, initializing a non-React library), use the designated useMountEffect hook.

Do NOT write raw useEffect even for these cases. Use the abstraction:

// utils/hooks.tsexport function useMountEffect(effect: () => void | (() => void)) {  /* eslint-disable no-restricted-syntax */  useEffect(effect, []);}
3. Code Generation Guidelines
When generating React components, default to writing logic inside event handlers (onClick, onSubmit), not inside effects.
Use memoization (useMemo, useCallback) only if performance profiling proves it is necessary, not as a default.
Prefer declarative logic. The UI should be a function of State -> JSX. Avoid imperative chains of side effects.
4. Handling Agents/AI
If you see an opportunity to remove a useEffect, take it.
Never add a useEffect "just in case" to sync state.
Warn the user if a third-party library forces them to use useEffect and suggest alternatives if they exist.