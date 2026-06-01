import { useState } from "react";
import type { CSSProperties } from "react";
import { companyColor, companyLogoUrl } from "../utils/jobPresentation";

interface Props {
  company?: string | null;
  size?: "sm" | "md" | "lg";
}

export default function CompanyLogo({ company, size = "md" }: Props) {
  const [failed, setFailed] = useState(false);
  const logoUrl = failed ? null : companyLogoUrl(company);
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
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}
