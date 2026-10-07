"use client";

import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

type CategoryOption = { id: string; name: string };

export function CategoryCombobox({
  categories,
  value,
  onChange,
  hintId,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (id: string) => void;
  hintId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = categories.find((category) => category.id === value);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("sr");
    return normalizedQuery
      ? categories.filter((category) => category.name.toLocaleLowerCase("sr").includes(normalizedQuery))
      : categories;
  }, [categories, query]);

  function closeIfFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setOpen(false);
  }

  function focusOption(event: KeyboardEvent<HTMLButtonElement>, direction: -1 | 1) {
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const index = options.indexOf(event.currentTarget);
    const next = options[index + direction];
    if (next) {
      event.preventDefault();
      next.focus();
    } else if (direction === -1) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  }

  return (
    <div className="category-combobox" ref={rootRef} onBlur={closeIfFocusLeaves}>
      <input
        ref={inputRef}
        id="kategorija"
        className="input category-combobox__input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="kategorija-opcije"
        aria-describedby={hintId}
        autoComplete="off"
        placeholder={categories.length === 0 ? "Nema aktivnih kategorija" : "Izaberite ili pretražite"}
        value={open ? query : selected?.name ?? ""}
        disabled={categories.length === 0}
        onFocus={() => {
          if (!open) {
            setQuery("");
            setOpen(true);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          } else if (event.key === "ArrowDown" && open) {
            event.preventDefault();
            rootRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
          }
        }}
      />
      <input type="hidden" name="kategorija" value={value} />
      {open && categories.length > 0 ? (
        <ul
          className="category-combobox__options"
          id="kategorija-opcije"
          role="listbox"
          aria-label="Kategorije"
        >
          {filtered.length === 0 ? (
            <li className="category-combobox__empty" role="presentation">
              Nema kategorija koje odgovaraju pretrazi.
            </li>
          ) : (
            filtered.map((category) => (
              <li key={category.id} role="presentation">
                <button
                  className="category-combobox__option"
                  type="button"
                  role="option"
                  aria-selected={category.id === value}
                  onClick={() => {
                    onChange(category.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") focusOption(event, 1);
                    else if (event.key === "ArrowUp") focusOption(event, -1);
                    else if (event.key === "Escape") {
                      setOpen(false);
                      inputRef.current?.focus();
                    }
                  }}
                >
                  {category.name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
