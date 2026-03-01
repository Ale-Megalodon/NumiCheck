type BrandWordmarkProps = {
  className?: string;
  weight?: "semibold" | "bold";
};

export function BrandWordmark({ className = "", weight = "bold" }: BrandWordmarkProps) {
  const classes = `brand-wordmark brand-wordmark--${weight} notranslate ${className}`.trim();

  return (
    <h1 className={classes} aria-label="NumiCheck" translate="no" lang="zxx">
      <span>Num</span>
      <span className="brand-i" aria-hidden="true">
        <span className="brand-i-stem" />
        <span className="brand-i-dot" />
      </span>
      <span>Check</span>
    </h1>
  );
}
