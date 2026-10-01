export interface StateInfo {
  readonly abbr: string;
  readonly fips: string;
  readonly name: string;
  readonly seats: number;
}

export const STATES: readonly StateInfo[] = [
  { abbr: 'AL', fips: '01', name: 'Alabama', seats: 7 },
  { abbr: 'AK', fips: '02', name: 'Alaska', seats: 1 },
  { abbr: 'AZ', fips: '04', name: 'Arizona', seats: 9 },
  { abbr: 'AR', fips: '05', name: 'Arkansas', seats: 4 },
  { abbr: 'CA', fips: '06', name: 'California', seats: 52 },
  { abbr: 'CO', fips: '08', name: 'Colorado', seats: 8 },
  { abbr: 'CT', fips: '09', name: 'Connecticut', seats: 5 },
  { abbr: 'DE', fips: '10', name: 'Delaware', seats: 1 },
  { abbr: 'FL', fips: '12', name: 'Florida', seats: 28 },
  { abbr: 'GA', fips: '13', name: 'Georgia', seats: 14 },
  { abbr: 'HI', fips: '15', name: 'Hawaii', seats: 2 },
  { abbr: 'ID', fips: '16', name: 'Idaho', seats: 2 },
  { abbr: 'IL', fips: '17', name: 'Illinois', seats: 17 },
  { abbr: 'IN', fips: '18', name: 'Indiana', seats: 9 },
  { abbr: 'IA', fips: '19', name: 'Iowa', seats: 4 },
  { abbr: 'KS', fips: '20', name: 'Kansas', seats: 4 },
  { abbr: 'KY', fips: '21', name: 'Kentucky', seats: 6 },
  { abbr: 'LA', fips: '22', name: 'Louisiana', seats: 6 },
  { abbr: 'ME', fips: '23', name: 'Maine', seats: 2 },
  { abbr: 'MD', fips: '24', name: 'Maryland', seats: 8 },
  { abbr: 'MA', fips: '25', name: 'Massachusetts', seats: 9 },
  { abbr: 'MI', fips: '26', name: 'Michigan', seats: 13 },
  { abbr: 'MN', fips: '27', name: 'Minnesota', seats: 8 },
  { abbr: 'MS', fips: '28', name: 'Mississippi', seats: 4 },
  { abbr: 'MO', fips: '29', name: 'Missouri', seats: 8 },
  { abbr: 'MT', fips: '30', name: 'Montana', seats: 2 },
  { abbr: 'NE', fips: '31', name: 'Nebraska', seats: 3 },
  { abbr: 'NV', fips: '32', name: 'Nevada', seats: 4 },
  { abbr: 'NH', fips: '33', name: 'New Hampshire', seats: 2 },
  { abbr: 'NJ', fips: '34', name: 'New Jersey', seats: 12 },
  { abbr: 'NM', fips: '35', name: 'New Mexico', seats: 3 },
  { abbr: 'NY', fips: '36', name: 'New York', seats: 26 },
  { abbr: 'NC', fips: '37', name: 'North Carolina', seats: 14 },
  { abbr: 'ND', fips: '38', name: 'North Dakota', seats: 1 },
  { abbr: 'OH', fips: '39', name: 'Ohio', seats: 15 },
  { abbr: 'OK', fips: '40', name: 'Oklahoma', seats: 5 },
  { abbr: 'OR', fips: '41', name: 'Oregon', seats: 6 },
  { abbr: 'PA', fips: '42', name: 'Pennsylvania', seats: 17 },
  { abbr: 'RI', fips: '44', name: 'Rhode Island', seats: 2 },
  { abbr: 'SC', fips: '45', name: 'South Carolina', seats: 7 },
  { abbr: 'SD', fips: '46', name: 'South Dakota', seats: 1 },
  { abbr: 'TN', fips: '47', name: 'Tennessee', seats: 9 },
  { abbr: 'TX', fips: '48', name: 'Texas', seats: 38 },
  { abbr: 'UT', fips: '49', name: 'Utah', seats: 4 },
  { abbr: 'VT', fips: '50', name: 'Vermont', seats: 1 },
  { abbr: 'VA', fips: '51', name: 'Virginia', seats: 11 },
  { abbr: 'WA', fips: '53', name: 'Washington', seats: 10 },
  { abbr: 'WV', fips: '54', name: 'West Virginia', seats: 2 },
  { abbr: 'WI', fips: '55', name: 'Wisconsin', seats: 8 },
  { abbr: 'WY', fips: '56', name: 'Wyoming', seats: 1 },
];

export function stateByAbbr(abbr: string): StateInfo | undefined {
  const up = abbr.toUpperCase();
  return STATES.find((s) => s.abbr === up);
}
