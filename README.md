# BattleShip Arcade

Ett online-sänka-skepp-spel med lobbykod, backend, klassiska koordinater och placeholder-grafik.

## Grafik och assets

GitHub Pages kan hosta spelets statiska grafik i repot, till exempel optimerade `webp`, `png`, `svg`, `css` och korta ljudfiler. Håll web assets små och lägg inte stora originalfiler, videor eller genererade bildbatcher i Git-historiken. Använd hellre komprimerade produktionsfiler i `public/assets/` när grafiken ska snyggas till.

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
- Rumskoden gäller i 5 minuter. Om ingen ansluter går rummet ut.
- Båda placerar fem klassiska skepp manuellt eller med auto-placering.
- Spelplanerna visar klassiska koordinater: A-J och 1-10.
- Skaparen väljer Classic eller Arcade när rummet skapas.
- När båda är redo startar matchen.
- En match kan som längst pågå i 48 timmar från att rummet skapas. Därefter avslutas den utan highscore.
- Spelet visar matchtid, kvarvarande tid och hur länge du väntat på motståndarens drag.
- Classic växlar tur efter varje skott och har inga förmågor.
- Arcade ger energi vid träffar, låter träffar behålla turen och aktiverar förmågor.
- Sonar kostar energi och visar hur många skeppsdelar som finns i ett 3x3-område i Arcade.
- Barrage kostar mer energi och skjuter ett kors med upp till fem rutor i Arcade.
- Spelet räknar skott, träffar, missar och precision per match.
- Topplistan finns som separat vy, rankar snabbast vunna matcher och visar mode, tid, skott, träffar, missar och precision.
- Spelarnamn filtreras i backend med en enkel svensk/engelsk profanity-lista.

Matcher och topplista sparas i minnet i den lokala backend-processen. Startas servern om försvinner aktiva rum och lokala scoreposter.

Node.js behövs bara för lokal utveckling och test av den lokala servern. I Supabase-läge körs backendlogiken i Supabase Edge Functions och datan ligger i Postgres.

## Supabase-läge

Supabase används som backend: Postgres lagrar matcher och topplista, en Edge Function kör spelreglerna, och Realtime lyssnar på en separat tick-tabell som inte innehåller gömda skepp.

## Automatisk Supabase-deploy

GitHub Actions-workflowen `.github/workflows/deploy-supabase.yml` deployar migrationer och Edge Function till projektet `rsfrhxpduqhtfgenxdoh` när `supabase/` ändras på `main`.

Lägg in dessa i GitHub-repots **Settings > Secrets and variables > Actions > Repository secrets**:

- `SUPABASE_ACCESS_TOKEN`: Supabase personal access token från Supabase Dashboard.
- `SUPABASE_DB_PASSWORD`: databaslösenordet du valde när projektet skapades.

Det här är GitHub Actions-secrets, inte Supabase Function-secrets. Det är därför okej att de börjar med `SUPABASE_` här.

Efter att secretsen finns på plats kan du starta deployen manuellt via **Actions > Deploy Supabase > Run workflow**. Nästa ändring i `supabase/` på `main` kör den också automatiskt.

1. Skapa ett Supabase-projekt.
2. Kör SQL-filen `supabase/migrations/20260609081500_battleship_arcade.sql` i Supabase SQL Editor eller via Supabase CLI.
   Filen är säker att köra igen när schemat uppdateras, till exempel för att lägga till nya topplistekolumner.
3. Deploya funktionen:

```powershell
supabase functions deploy battleship
```

4. Edge Functions har Supabase-defaults som `SUPABASE_URL` och `SUPABASE_SECRET_KEYS` automatiskt. Skapa inte egna secrets som börjar med `SUPABASE_`; Supabase reserverar de namnen.

5. Funktionen fungerar med legacy `anon` key. Om du använder ny `sb_publishable_...` key i stället behöver funktionen köras utan JWT-krav. I CLI styrs det av `supabase/config.toml`. I dashboarden heter det ofta **Enforce JWT Verification** och ska vara avstängt för `battleship`.

6. Ändra `public/config.js`:

```js
window.BATTLESHIP_CONFIG = {
  backend: 'supabase',
  supabaseUrl: 'https://DIN-PROJEKTREF.supabase.co',
  supabaseKey: 'DIN_PUBLISHABLE_KEY',
  supabaseFunctionName: 'battleship',
  supabaseSdkUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
};
```

Använd i första hand `sb_publishable_...` från Supabase API Keys. Legacy `anon`-nyckeln och `sb_publishable_...`-nycklar är publika och får ligga i frontend. Secret key och `service_role` ska aldrig in i GitHub eller frontend. Frontendens `public`-mapp kan hostas statiskt, till exempel på Netlify, Vercel, GitHub Pages eller Supabase Storage.
