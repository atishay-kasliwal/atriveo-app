/** Display saved location text consistently without guessing missing geography. */
const STATES: Record<string, string> = Object.fromEntries(`AL|Alabama;AK|Alaska;AZ|Arizona;AR|Arkansas;CA|California;CO|Colorado;CT|Connecticut;DE|Delaware;DC|District of Columbia;FL|Florida;GA|Georgia;HI|Hawaii;ID|Idaho;IL|Illinois;IN|Indiana;IA|Iowa;KS|Kansas;KY|Kentucky;LA|Louisiana;ME|Maine;MD|Maryland;MA|Massachusetts;MI|Michigan;MN|Minnesota;MS|Mississippi;MO|Missouri;MT|Montana;NE|Nebraska;NV|Nevada;NH|New Hampshire;NJ|New Jersey;NM|New Mexico;NY|New York;NC|North Carolina;ND|North Dakota;OH|Ohio;OK|Oklahoma;OR|Oregon;PA|Pennsylvania;RI|Rhode Island;SC|South Carolina;SD|South Dakota;TN|Tennessee;TX|Texas;UT|Utah;VT|Vermont;VA|Virginia;WA|Washington;WV|West Virginia;WI|Wisconsin;WY|Wyoming;PR|Puerto Rico;GU|Guam;VI|U.S. Virgin Islands;AS|American Samoa;MP|Northern Mariana Islands`.split(';').flatMap((entry) => {
  const [code, name] = entry.split('|');
  return [[code.toLowerCase(), code], [name.toLowerCase(), code]];
}));
const stateCode = (text: string) => STATES[text.trim().toLowerCase()];

export function formatLocation(value?: string | null): string {
  if (!value) return '';
  const text = value.replace(/&amp;/gi, '&').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim();
  if (/^remote$/i.test(text)) return 'Remote';
  if (/^(?:us|usa|united states(?: of america)?)$/i.test(text)) return 'United States';
  // Multiple locations and work-mode qualifiers carry meaning; preserve them.
  if (/[;/|()]|\b(?:remote|hybrid|on[- ]site)\b/i.test(text)) return text;
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && /^(?:us|usa|united states(?: of america)?)$/i.test(parts.at(-1)!)) parts.pop();
  if (parts.length === 2) {
    const last = stateCode(parts[1]);
    if (last) return `${parts[0]}, ${last}`;
    const first = stateCode(parts[0]);
    if (first) return `${parts[1]}, ${first}`;
  }
  // Staffing feeds put a two-letter state first, with or without a dash.
  const prefix = text.match(/^([A-Z]{2})\s+(?:[-–—]\s*)?(.+)$/);
  if (prefix && stateCode(prefix[1]) && !/\d/.test(prefix[2])) return `${prefix[2]}, ${stateCode(prefix[1])}`;
  if (parts.length === 1 && stateCode(parts[0])) return stateCode(parts[0])!;
  return text;
}
