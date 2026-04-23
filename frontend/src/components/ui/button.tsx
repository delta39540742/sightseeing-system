import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg' | 'icon'
}

const variants: Record<string, string> = {
  default:     'btn-primary',
  outline:     'btn-secondary',
  ghost:       'btn text-gray-600 hover:bg-gray-100',
  destructive: 'btn-danger',
}

export function Button({ variant = 'default', size, className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
