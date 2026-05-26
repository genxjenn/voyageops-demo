import { cn } from "@/lib/utils";

type HeadingProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageTitle({ children, className }: HeadingProps) {
  return (
    <h1 className={cn("text-3xl font-bold text-sectionHeading", className)}>
      {children}
    </h1>
  );
}

export function SectionTitle({ children, className }: HeadingProps) {
  return (
    <h2 className={cn("text-xl font-bold text-sectionHeading", className)}>
      {children}
    </h2>
  );
}

export function SubsectionTitle({ children, className }: HeadingProps) {
  return (
    <h3 className={cn("text-base font-bold text-sectionHeading", className)}>
      {children}
    </h3>
  );
}

type SectionSubtitleProps = HeadingProps & {
  size?: "default" | "sm";
};

export function SectionSubtitle({ children, className, size = "default" }: SectionSubtitleProps) {
  return (
    <p
      className={cn(
        "font-medium text-subtitle",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      {children}
    </p>
  );
}
