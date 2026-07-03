import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

function TextField({
  label,
  ...inputProps
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const field = useFieldContext<string>();
  const error = field.state.meta.isTouched ? field.state.meta.errors[0] : undefined;

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        {...inputProps}
        className="input"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {error && <span className="field-error">{String(error)}</span>}
    </label>
  );
}

function SubmitButton({ children, pending }: { children: React.ReactNode; pending?: boolean }) {
  return (
    <button type="submit" className="button button-primary" disabled={pending}>
      {children}
    </button>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton }
});
