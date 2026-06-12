import { useState } from "react";
import type { CSSProperties } from "react";
import { companyColor, companyLogoUrls } from "../utils/jobPresentation";

interface Props {
  company?: string | null;
  size?: "sm" | "md" | "lg";
}

export default function CompanyLogo({ company, size = "md" }: Props) {
  const urls = companyLogoUrls(company);
  const [urlIndex, setUrlIndex] = useState(0);
  const logoUrl = urlIndex < urls.length ? urls[urlIndex] : null;
  const initial = company?.trim().charAt(0).toUpperCase() || "A";
  const style = { "--company-color": companyColor(company) } as CSSProperties;

  return (
    <span
      className={`company-logo company-logo--${size}${logoUrl ? " has-logo" : ""}`}
      style={style}
      aria-hidden="true"
    >
      {logoUrl ? (
        <img
          key={logoUrl}
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setUrlIndex((i) => i + 1)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
