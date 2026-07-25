import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // min-h-11 keeps every control at a comfortable tap target on a phone with
  // gloves on, which is the actual usage context here. `press` adds the small
  // scale-down on tap defined in globals.css.
  "press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold tracking-tight disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground shadow-[var(--shadow-sm)] hover:bg-accent-strong",
        secondary:
          "border border-border bg-surface text-ink shadow-[var(--shadow-sm)] hover:border-border-strong hover:bg-surface-3",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        default: "",
        sm: "min-h-9 rounded-lg px-3.5 text-xs",
        lg: "min-h-12 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
