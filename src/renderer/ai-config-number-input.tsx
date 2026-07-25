import { useEffect, useRef, useState } from "react";

export type AiConfigNumberInputProps = {
  id: string;
  value: number;
  onCommit: (value: number) => void;
  /** Called on blur (and Enter) only — not while typing. */
  normalize: (raw: unknown) => number;
  className?: string;
};

/**
 * Numeric field for AI settings: free typing while focused, clamp/validate on blur.
 */
export function AiConfigNumberInput({
  id,
  value,
  onCommit,
  normalize,
  className = "text-field ai-config-input",
}: AiConfigNumberInputProps) {
  const [draft, setDraft] = useState(() => String(value));
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  const commitDraft = () => {
    const committed = normalize(draft);
    onCommit(committed);
    setDraft(String(committed));
  };

  return (
    <input
      className={className}
      id={id}
      inputMode="numeric"
      onBlur={() => {
        isFocusedRef.current = false;
        commitDraft();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      type="text"
      value={draft}
    />
  );
}
