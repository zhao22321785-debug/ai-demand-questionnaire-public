interface OptionListItem {
  value: string;
  label: string;
  description?: string;
}

interface OptionListProps {
  name: string;
  options: OptionListItem[];
  value?: string;
  onChange: (value: string) => void;
}

export function OptionList({ name, options, value, onChange }: OptionListProps) {
  return (
    <div className="option-list">
      {options.map((option) => (
        <label className={`option-row${value === option.value ? ' is-selected' : ''}`} key={option.value}>
          <input
            checked={value === option.value}
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          <span className="option-row__marker" aria-hidden="true" />
          <span>
            <strong>{option.label}</strong>
            {option.description ? <small>{option.description}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}
