import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // min-h-11 keeps every control at a comfortable tap target on a phone with
  // gloves on, which is the actual usage context here. `press` adds the small
  // scale-down on tap defined in globals.css.
  "press inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground shadow-[var(--shadow-sm)] hover:bg-accent-strong",
        secondary:
          "border border-border-strong bg-surface text-ink hover:border-ink-3/40 hover:bg-surface-3",
        soft: "bg-accent-soft text-accent hover:bg-accent-soft/70",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        default: "",
        sm: "min-h-9 rounded-lg px-3.5 text-xs",
        lg: "min-h-12 px-6 text-base",
        icon: "size-10 min-h-10 px-0",
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
