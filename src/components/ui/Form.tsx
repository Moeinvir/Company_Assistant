import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
  optional,
  action,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={htmlFor} className="text-2xs font-medium text-ink-soft">
            {label}
            {optional ? <span className="ms-1.5 font-normal text-ink-faint">optional</span> : null}
          </label>
          {action}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-2xs leading-relaxed text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn("control h-9.5", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn("control resize-y leading-relaxed", className)}
        {...rest}
      />
    );
  },
);

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...rest },
  ref,
) {
  const groups = new Map<string, SelectOption[]>();
  for (const option of options) {
    const key = option.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn("control h-9.5 cursor-pointer appearance-none pe-8", className)}
        {...rest}
      >
        {[...groups.entries()].map(([group, entries]) =>
          group ? (
            <optgroup key={group} label={group}>
              {entries.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : (
            entries.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))
          ),
        )}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  );
});

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id: providedId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const id = providedId ?? generated;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-micro font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-45",
          checked
            ? "border-transparent bg-accent"
            : "border-hairline-strong bg-surface-3 hover:border-hairline-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full shadow-sm transition-all duration-200",
            checked ? "start-[calc(100%-1.125rem)] bg-accent-contrast" : "start-0.5 bg-ink-faint",
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  hint,
  format,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
  hint?: ReactNode;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const percent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xs font-medium text-ink-soft">{label}</span>
          <span className="font-mono text-2xs tabular-nums text-ink-mute">
            {format ? format(value) : value.toFixed(2)}
          </span>
        </div>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={typeof label === "string" ? label : undefined}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:opacity-45 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/40 [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_0_10px_var(--accent-glow)] [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent"
        style={{
          background: `linear-gradient(var(--slider-angle, 90deg), color-mix(in oklab, var(--accent) 78%, transparent) ${percent}%, var(--color-surface-3) ${percent}%)`,
        }}
      />
      {hint ? <p className="text-2xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          checked ? "border-transparent bg-accent" : "border-hairline-strong bg-surface-2",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40",
        )}
      >
        {checked ? <Check className="size-3 text-accent-contrast" aria-hidden /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-micro font-medium text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-2xs text-ink-mute">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Small inline radio group rendered as connected segments. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] border border-hairline bg-black/25 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[8px] font-medium transition-colors duration-150",
              size === "sm" ? "px-2 py-1 text-2xs" : "px-2.5 py-1.5 text-2xs",
              active
                ? "bg-surface-3 text-ink shadow-hair"
                : "text-ink-mute hover:text-ink-soft",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
