// Builds data/fixtures.json from a compact match table.
// Kickoffs are stored as UTC ISO. June 2026 US Eastern = EDT = UTC-4,
// Central = CDT = UTC-5, Mountain = MDT = UTC-6, Pacific = PDT = UTC-7.
// We store the listed ET time -> UTC (ET+4h). The client renders in MYT.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

const FLAGS = {
  Portugal: "🇵🇹", "DR Congo": "🇨🇩", England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Croatia: "🇭🇷",
  Ghana: "🇬🇭", Panama: "🇵🇦", Uzbekistan: "🇺🇿", Colombia: "🇨🇴",
  Czechia: "🇨🇿", "South Africa": "🇿🇦", Switzerland: "🇨🇭", Bosnia: "🇧🇦",
  Canada: "🇨🇦", Qatar: "🇶🇦", Mexico: "🇲🇽", "South Korea": "🇰🇷",
  USA: "🇺🇸", Australia: "🇦🇺", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", Morocco: "🇲🇦",
  Brazil: "🇧🇷", Haiti: "🇭🇹", Turkiye: "🇹🇷", Paraguay: "🇵🇾",
  Netherlands: "🇳🇱", Sweden: "🇸🇪", Germany: "🇩🇪", "Ivory Coast": "🇨🇮",
  Ecuador: "🇪🇨", Curacao: "🇨🇼", Tunisia: "🇹🇳", Japan: "🇯🇵",
  Spain: "🇪🇸", "Saudi Arabia": "🇸🇦", Belgium: "🇧🇪", Iran: "🇮🇷",
  "New Zealand": "🇳🇿", Egypt: "🇪🇬", Uruguay: "🇺🇾", "Cape Verde": "🇨🇻",
  Argentina: "🇦🇷", Austria: "🇦🇹", France: "🇫🇷", Iraq: "🇮🇶",
  Norway: "🇳🇴", Senegal: "🇸🇳", Jordan: "🇯🇴", Algeria: "🇩🇿",
};

const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);

// [group, home, away, city, venue, "YYYY-MM-DDTHH:MM" in ET]
const TABLE = [
  // Matchday 1
  ["K", "Portugal", "DR Congo", "Houston", "NRG Stadium", "2026-06-17T12:00"],
  ["L", "England", "Croatia", "Dallas", "AT&T Stadium", "2026-06-17T16:00"],
  ["L", "Ghana", "Panama", "Toronto", "BMO Field", "2026-06-17T19:00"],
  ["K", "Uzbekistan", "Colombia", "Mexico City", "Estadio Azteca", "2026-06-17T22:00"],
  ["A", "Czechia", "South Africa", "Atlanta", "Mercedes-Benz Stadium", "2026-06-18T12:00"],
  ["B", "Switzerland", "Bosnia", "Los Angeles", "SoFi Stadium", "2026-06-18T12:00"],
  ["B", "Canada", "Qatar", "Vancouver", "BC Place", "2026-06-18T15:00"],
  ["A", "Mexico", "South Korea", "Guadalajara", "Estadio Akron", "2026-06-18T19:00"],
  ["D", "USA", "Australia", "Seattle", "Lumen Field", "2026-06-19T12:00"],
  ["C", "Scotland", "Morocco", "Boston", "Gillette Stadium", "2026-06-19T18:00"],
  ["C", "Brazil", "Haiti", "Philadelphia", "Lincoln Financial Field", "2026-06-19T20:30"],
  ["D", "Turkiye", "Paraguay", "San Francisco", "Levi's Stadium", "2026-06-19T21:00"],
  ["F", "Netherlands", "Sweden", "Houston", "NRG Stadium", "2026-06-20T12:00"],
  ["E", "Germany", "Ivory Coast", "Toronto", "BMO Field", "2026-06-20T16:00"],
  ["E", "Ecuador", "Curacao", "Kansas City", "Arrowhead Stadium", "2026-06-20T19:00"],
  ["F", "Tunisia", "Japan", "Monterrey", "Estadio BBVA", "2026-06-20T22:00"],
  ["H", "Spain", "Saudi Arabia", "Atlanta", "Mercedes-Benz Stadium", "2026-06-21T12:00"],
  ["G", "Belgium", "Iran", "Los Angeles", "SoFi Stadium", "2026-06-21T12:00"],
  ["G", "New Zealand", "Egypt", "Vancouver", "BC Place", "2026-06-21T18:00"],
  ["H", "Uruguay", "Cape Verde", "Miami", "Hard Rock Stadium", "2026-06-21T18:00"],
  ["J", "Argentina", "Austria", "Dallas", "AT&T Stadium", "2026-06-22T12:00"],
  ["I", "France", "Iraq", "Philadelphia", "Lincoln Financial Field", "2026-06-22T17:00"],
  ["I", "Norway", "Senegal", "New Jersey", "MetLife Stadium", "2026-06-22T20:00"],
  ["J", "Jordan", "Algeria", "San Francisco", "Levi's Stadium", "2026-06-22T20:00"],
  // Matchday 2
  ["K", "Portugal", "Uzbekistan", "Houston", "NRG Stadium", "2026-06-23T12:00"],
  ["L", "England", "Ghana", "Boston", "Gillette Stadium", "2026-06-23T16:00"],
  ["L", "Panama", "Croatia", "Toronto", "BMO Field", "2026-06-23T19:00"],
  ["K", "Colombia", "DR Congo", "Guadalajara", "Estadio Akron", "2026-06-23T20:00"],
  // Matchday 3 (simultaneous per group)
  ["A", "Czechia", "Mexico", "Mexico City", "Estadio Azteca", "2026-06-24T19:00"],
  ["A", "South Africa", "South Korea", "Monterrey", "Estadio BBVA", "2026-06-24T19:00"],
  ["B", "Switzerland", "Canada", "Vancouver", "BC Place", "2026-06-24T12:00"],
  ["B", "Bosnia", "Qatar", "Seattle", "Lumen Field", "2026-06-24T12:00"],
  ["C", "Scotland", "Brazil", "Miami", "Hard Rock Stadium", "2026-06-24T18:00"],
  ["C", "Morocco", "Haiti", "Atlanta", "Mercedes-Benz Stadium", "2026-06-24T18:00"],
  ["D", "Turkiye", "USA", "Los Angeles", "SoFi Stadium", "2026-06-25T19:00"],
  ["D", "Paraguay", "Australia", "San Francisco", "Levi's Stadium", "2026-06-25T19:00"],
  ["E", "Ecuador", "Germany", "New Jersey", "MetLife Stadium", "2026-06-25T16:00"],
  ["E", "Curacao", "Ivory Coast", "Philadelphia", "Lincoln Financial Field", "2026-06-25T16:00"],
  ["F", "Japan", "Sweden", "Dallas", "AT&T Stadium", "2026-06-25T18:00"],
  ["F", "Tunisia", "Netherlands", "Kansas City", "Arrowhead Stadium", "2026-06-25T18:00"],
  ["G", "Egypt", "Iran", "Seattle", "Lumen Field", "2026-06-26T20:00"],
  ["G", "New Zealand", "Belgium", "Vancouver", "BC Place", "2026-06-26T20:00"],
  ["H", "Cape Verde", "Saudi Arabia", "Houston", "NRG Stadium", "2026-06-26T19:00"],
  ["H", "Uruguay", "Spain", "Guadalajara", "Estadio Akron", "2026-06-26T18:00"],
  ["I", "Norway", "France", "Boston", "Gillette Stadium", "2026-06-26T15:00"],
  ["I", "Senegal", "Iraq", "Toronto", "BMO Field", "2026-06-26T15:00"],
  ["J", "Algeria", "Austria", "Kansas City", "Arrowhead Stadium", "2026-06-27T21:00"],
  ["J", "Jordan", "Argentina", "Dallas", "AT&T Stadium", "2026-06-27T21:00"],
  ["K", "Colombia", "Portugal", "Miami", "Hard Rock Stadium", "2026-06-27T19:30"],
  ["K", "DR Congo", "Uzbekistan", "Atlanta", "Mercedes-Benz Stadium", "2026-06-27T19:30"],
  ["L", "Panama", "England", "New Jersey", "MetLife Stadium", "2026-06-27T17:00"],
  ["L", "Croatia", "Ghana", "Philadelphia", "Lincoln Financial Field", "2026-06-27T17:00"],
];

const fixtures = TABLE.map(([group, home, away, city, venue, etLocal]) => {
  // ET (EDT) = UTC-4 -> add 4h to get UTC
  const [datePart, timePart] = etLocal.split("T");
  const [Y, M, D] = datePart.split("-").map(Number);
  const [h, m] = timePart.split(":").map(Number);
  const utc = new Date(Date.UTC(Y, M - 1, D, h + 4, m));
  const id = `${slug(home)}-${slug(away)}-${datePart}`;
  return {
    id,
    group,
    home: { name: home, flag: FLAGS[home] || "🏳️" },
    away: { name: away, flag: FLAGS[away] || "🏳️" },
    venue,
    city,
    kickoffUTC: utc.toISOString(),
    etLabel: `${timePart} ET`,
  };
});

mkdirSync(`${__dir}/../data`, { recursive: true });
writeFileSync(`${__dir}/../data/fixtures.json`, JSON.stringify(fixtures, null, 2));
console.log(`Wrote ${fixtures.length} fixtures.`);
