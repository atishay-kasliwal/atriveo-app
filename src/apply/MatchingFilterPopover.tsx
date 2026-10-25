import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Native top-layer popover: anchored to its trigger and kept inside the viewport. */
export default function MatchingFilterPopover({
  label,
  title,
  description,
  active,
  icon,
  caption,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  active: boolean;
  icon: ReactNode;
  caption: string;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState(false);
  const position = useCallback(() => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect(),
      box = panel.current,
      pad = 12;
    const width = Math.min(292, window.innerWidth - pad * 2);
    box.style.width = `${width}px`;
    box.style.maxHeight = `${window.innerHeight - pad * 2}px`;
    box.style.left = `${Math.max(pad, anchor.left - width - 10)}px`;
    box.style.top = `${Math.max(pad, Math.min(anchor.top, window.innerHeight - box.getBoundingClientRect().height - pad))}px`;
  }, []);
  const close = () => {
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);
  useEffect(() => {
    if (!open) return;
    const box = panel.current!,
      observer = new ResizeObserver(position);
    observer.observe(box);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [open, position]);
  return (
    <div
      className="jm-filter-tool"
      data-active={active}
      data-open={open}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          panel.current?.hidePopover();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.target === trigger.current && e.key === "ArrowDown") {
          e.preventDefault();
          panel.current?.showPopover();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="jm-filter-trigger"
        popoverTarget={id}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
      >
        {icon}
        <small>{caption}</small>
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        className="jm-filter-popover"
        role="dialog"
        aria-labelledby={`${id}-title`}
        onBeforeToggle={(e) => {
          if (e.newState === "open") position();
        }}
        onToggle={(e) => {
          const shown = e.newState === "open";
          setOpen(shown);
          if (shown) {
            position();
            const first =
              panel.current?.querySelector<HTMLElement>(
                "[data-popover-focus]",
              ) ||
              panel.current?.querySelector<HTMLElement>(
                '[aria-checked="true"]',
              ) ||
              panel.current?.querySelector<HTMLElement>("input") ||
              panel.current?.querySelector<HTMLElement>("button");
            first?.focus({ preventScroll: true });
          }
        }}
      >
        <header className="jm-filter-popup-header">
          <div>
            <h3 id={`${id}-title`}>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="jm-filter-close"
            onClick={close}
            aria-label={`Close ${title.toLowerCase()} filters`}
          >
            ×
          </button>
        </header>
        {children(close)}
      </div>
    </div>
  );
}

export function FilterChoices({
  label,
  value,
  options,
  onChoose,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onChoose: (value: string) => void;
}) {
  return (
    <div
      className="jm-filter-choices"
      role="menu"
      aria-label={label}
      onKeyDown={(e) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const choices = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitemradio"]',
            ),
          ],
          index = choices.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? choices.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : choices.length - 1)) %
                choices.length;
        choices[next]?.focus();
      }}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="menuitemradio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChoose(option.value)}
        >
          <span>
            <b>{option.label}</b>
            {option.description && <small>{option.description}</small>}
          </span>
          <span className="jm-filter-check" aria-hidden="true">
            {value === option.value ? "✓" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
