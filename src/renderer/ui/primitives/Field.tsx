import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { cx, mergeAriaDescribedBy, type ClassName } from './cx';

export type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'> & {
  readonly children: ReactNode;
  readonly label?: ReactNode;
  readonly htmlFor?: string;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
};

export type FieldIds = {
  readonly controlId: string;
  readonly descriptionId: string;
  readonly errorId: string;
};

export function getFieldIds(id: string): FieldIds {
  return {
    controlId: id,
    descriptionId: `${id}-description`,
    errorId: `${id}-error`,
  };
}

export function getFieldAriaProps(
  ids: Pick<FieldIds, 'descriptionId' | 'errorId'>,
  options: { readonly hasDescription?: boolean; readonly hasError?: boolean } = {},
): {
  readonly 'aria-describedby'?: string;
  readonly 'aria-errormessage'?: string;
  readonly 'aria-invalid'?: true;
} {
  const describedBy = mergeAriaDescribedBy(
    options.hasDescription === true ? ids.descriptionId : undefined,
    options.hasError === true ? ids.errorId : undefined,
  );
  return {
    ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
    ...(options.hasError === true ? { 'aria-errormessage': ids.errorId, 'aria-invalid': true } : {}),
  };
}

export function Field({
  children,
  label,
  htmlFor,
  description,
  error,
  required = false,
  className,
  ...rest
}: FieldProps): ReactNode {
  return (
    <div {...rest} className={cx('ui-field', className)}>
      {label === undefined ? null : (
        <label className="ui-field__label" htmlFor={htmlFor}>
          <span className="ui-field__label-text">{label}</span>
          {required ? <span aria-hidden="true" className="ui-field__required">*</span> : null}
        </label>
      )}
      {children}
      {description === undefined ? null : (
        <div className="ui-field__description" id={htmlFor === undefined ? undefined : getFieldIds(htmlFor).descriptionId}>
          {description}
        </div>
      )}
      {error === undefined ? null : (
        <div className="ui-field__error" id={htmlFor === undefined ? undefined : getFieldIds(htmlFor).errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function useFieldId(id: string | undefined, prefix: string): string {
  const generatedId = useId();
  return id ?? `${prefix}-${generatedId}`;
}

export type FieldControlClassNameProps = {
  readonly className?: ClassName;
  readonly invalid?: boolean;
  readonly loading?: boolean;
};

export function getFieldControlClassName({
  className,
  invalid = false,
  loading = false,
}: FieldControlClassNameProps): string | undefined {
  return cx(
    'ui-field__control',
    invalid && 'ui-field__control--invalid',
    loading && 'ui-field__control--loading',
    className,
  );
}
