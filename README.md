# BattleShip Arcade

Ett online-sänka-skepp-spel med lobbykod, backend, klassiska koordinater och placeholder-grafik.

## Kör lokalt

```powershell
node server.js
```

Öppna sedan:

```text
http://localhost:3000
```

Den lokala servern binder som standard bara till `127.0.0.1`, så den är inte avsedd att vara nåbar från andra datorer. Om du aktivt vill testa över LAN kan du starta med `HOST=0.0.0.0`, men gör inte det när du fjärrstyr eller sitter på ett okänt nät.

På Windows kan `npm.ps1` vara blockerat av execution policy. Använd i så fall:

```powershell
npm.cmd start
npm.cmd test
```

## Spelidé

- En spelare skapar ett rum och får en kod.
- Andra spelaren anger koden för att gå med.
- Båda placerar fem klassiska skepp manuellt eller med auto-placering.
- Spelplanerna visar klassiska koordinater: A-J och 1-10.
- När båda är redo startar matchen.
- Vanliga träffar ger energi och låter spelaren fortsätta.
- Miss lämnar över turen.
- Sonar kostar energi och visar hur många skeppsdelar som finns i ett 3x3-område.
- Barrage kostar mer energi och skjuter ett kors med upp till fem rutor.
- Spelet räknar skott, träffar, missar och precision per match.
- Topplistan rankar snabbast vunna matcher och visar skott, träffar och missar.
- Spelarnamn filtreras i backend med en enkel svensk/engelsk profanity-lista.

Matcher och topplista sparas i minnet i den lokala backend-processen. Startas servern om försvinner aktiva rum och lokala scoreposter.

Node.js behövs bara för lokal utveckling och test av den lokala servern. I Supabase-läge körs backendlogiken i Supabase Edge Functions och datan ligger i Postgres.

## Supabase-läge

Supabase används som backend: Postgres lagrar matcher och topplista, en Edge Function kör spelreglerna, och Realtime lyssnar på en separat tick-tabell som inte innehåller gömda skepp.

1. Skapa ett Supabase-projekt.
2. Kör SQL-filen `supabase/migrations/20260609081500_battleship_arcade.sql` i Supabase SQL Editor eller via Supabase CLI.
3. Sätt Edge Function secrets om de inte redan finns i projektet:

```powershell
supabase secrets set SUPABASE_URL=https://DIN-PROJEKTREF.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=DIN_SERVICE_ROLE_KEY
```

4. Deploya funktionen:

```powershell
supabase functions deploy battleship
```

5. Ändra `public/config.js`:

```js
window.BATTLESHIP_CONFIG = {
  backend: 'supabase',
  supabaseUrl: 'https://DIN-PROJEKTREF.supabase.co',
  supabaseAnonKey: 'DIN_ANON_KEY',
  supabaseFunctionName: 'battleship',
  supabaseSdkUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
};
```

`anon`-nyckeln är publik och får ligga i frontend. `service_role`-nyckeln ska bara ligga som Supabase secret. Frontendens `public`-mapp kan hostas statiskt, till exempel på Netlify, Vercel, GitHub Pages eller Supabase Storage.
