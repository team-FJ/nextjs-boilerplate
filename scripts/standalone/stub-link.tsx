import type { AnchorHTMLAttributes, ReactNode } from "react";

// 単体HTML版には Next のルーターが無いので、素の <a> に置き換える
export default function Link({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
