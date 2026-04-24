import React from 'react'
import { Spinner } from './Spinner'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive' | 'success'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon'
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  fullWidth?: boolean
}

const variants: Record<string, string> = {
  default:     'btn-primary',
  outline:     'btn-secondary',
  ghost:       'btn text-gray-600 hover:bg-gray-100',
  destructive: 'btn-danger',
  success:     'btn bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500',
}

const sizes: Record<string, string> = {
  xs:   'px-2.5 py-1 text-xs rounded-md gap-1',
  sm:   'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md:   '',   // btn default handles this
  lg:   'px-6 py-3 text-base rounded-xl gap-2',
  icon: 'p-2 rounded-lg',
}

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        variants[variant],
        sizes[size] || '',
        fullWidth ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : leftIcon ? (
        leftIcon
      ) : null}
      {children}
      {!loading && rightIcon}
    </button>
  )
}
