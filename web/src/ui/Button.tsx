import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; block?: boolean };

export function Button({ variant = 'primary', block, className = '', ...rest }: Props) {
  const classes = ['btn', 'btn-' + variant, block ? 'btn-block' : '', className].filter(Boolean).join(' ');
  return <button {...rest} className={classes} />;
}
