# Lucky hours

One lucky window a day to apply in, from Vedic muhurta timings for where you are, plus a personal day rating from your birth chart.

## What decides the window

- **Choghadiya:** the day (sunrise to sunset) and the night are each split into eight equal parts, starting from the weekday's period. Amrit, Shubh and Labh are the good ones.
- **Hora:** planetary hours, twelve by day and twelve by night, starting with the weekday's lord. Jupiter, Venus and Mercury are the ones used.
- **Rahu Kaal:** one eighth of the day, fixed by the weekday. A window never overlaps it.
- **Working hours:** 9 AM to 9 PM by default. You can change them under Your details.

The lucky hour is the longest stretch where a good Choghadiya overlaps a good hora, outside Rahu Kaal and inside working hours. It is trimmed to at most 50 minutes around its middle, and must be at least 20 minutes long.

**Your day rating** comes from the moon's position. **Tara Bala** counts today's nakshatra from your birth nakshatra, and **Chandra Bala** counts today's moon sign from your birth moon sign. The page shows the result as good, mixed or careful. It does not move the window.

## Accuracy

- `scripts/lucky.mjs` has no dependencies.
- **Sun:** NOAA's solar position formulas. Sunrise and sunset are within about 2 minutes of Astronomy Engine.
- **Moon:** Meeus' lunar theory, the larger terms. It is within 0.008° of Astronomy Engine's true ecliptic longitude over 1995 to 2017. A nakshatra is 13.3° wide.
- **Ayanamsa:** Lahiri.
- Times are computed for the saved location, by default New York. The birth place is only a label; the chart needs only the birth instant.

## Where it shows

- **`/lucky`:**
  - The day as the sun's path: the Choghadiya bands, Rahu Kaal in red, the window in gold, and the countdown inside the arc.
  - A week dock below; tapping a day slides the gold to that day's window.
  - Your details: birth date, time, time zone and place, the city where you are now, and working hours.
  - The calendar link.
- **The nav:** the last item. It shows a tiny arc with your window and the sun, the start time, and a loading bar.
  - The bar fills over the 6 hours before the window.
  - In the last 15 minutes it reads "in 12m".
  - During the window the item turns gold, the bar drains, and it shows the time left.
  - After the window it shows the next one.
- **Matching:** a gold strip while the window is on, with the time left and how many you applied in it.
- **Phone notifications:** four, sent by the push loop in `push-events.mjs` → `tickLucky`, each sent once:
  - 15 minutes before
  - at the start
  - with 15 minutes left
  - at the end, with how many you applied
  - No notifications go out until the Lucky details have been saved once. The end-of-window count is kept in the `lucky_sessions` collection.

## Calendar

- **Add to Google Calendar** makes a private link, `/calendar/lucky/<48 hex>.ics`. Google fetches it without a sign-in. The website lets only that exact link shape through, and the route checks the token against `app_settings.lucky_profile.calendarToken`.
- **New link** replaces the token, and the old link stops working.
- The feed has 14 days: each lucky hour with a 15-minute alarm, and each Rahu Kaal.
- Google refreshes subscribed calendars every few hours to a day. The phone notifications do not depend on it.

## Data

`app_settings` `_id: "lucky_profile"` holds:
- `birthUtc`
- `birthPlace`
- `birthLocal`
- `location { name, lat, lon, tz }`
- `workStart`
- `workEnd`
- `calendarToken`

`GET /lucky` never returns `birthUtc` or the token.
