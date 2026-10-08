/** Settings → Meta: the step-by-step connection guide (PLAN.md §1.49, §5.O12). */

export const en = {
  "meta.title": "Instagram & Facebook (Meta)",
  "meta.intro":
    "Six steps connect your Instagram and Facebook accounts so the app can read how your posts do (and later publish them). Do them in order; each step shows a tick when the app can see it is done.",
  "meta.state.done": "Done",
  "meta.state.todo": "To do",
  "meta.state.unknown": "Checked after step 5",
  "meta.stillToDo": "Still to do: {list}",
  "meta.openLink": "Open",

  "meta.step.professional.title": "Switch each Instagram account to Professional",
  "meta.step.professional.body":
    "On your phone, in the Instagram app, for each account: Profile → ☰ menu → Settings and privacy → Account type and tools → Switch to professional account. Business or Creator both work. Then tick “Professional” on that account in Accounts.",
  "meta.step.professional.help": "Instagram help: switch to a professional account",
  "meta.step.professional.accounts": "Accounts in this app",
  "meta.step.professional.none": "Add your Instagram accounts in Accounts first.",

  "meta.step.pageLink.title": "Link each Instagram account to a Facebook Page",
  "meta.step.pageLink.body":
    "Meta only lets apps read Instagram through a Facebook Page, so every Instagram account needs a Page of its own. No Page yet? Create one (it can stay almost empty). Then in Instagram: Edit profile → Page → Connect an existing page. Or from the Page on Facebook: Settings → Linked accounts → Instagram → Connect.",
  "meta.step.pageLink.createPage": "Create a Facebook Page",
  "meta.step.pageLink.help": "Instagram help: link a Facebook Page",

  "meta.step.app.title": "Create a Meta developer app (type Business)",
  "meta.step.app.body":
    "Go to Meta for Developers → My Apps → Create app. Log in with your own Facebook account — that makes you the app's admin. Choose “Other”, then the app type “Business”, and name it e.g. “Content Engine”. In the app dashboard add the products “Facebook Login for Business” and “Instagram”. Leave the app in Development mode: nobody but you uses it, so there is nothing to send to Meta for review. (The app cannot see the app's mode or admins; this step ticks once the App ID is saved.)",
  "meta.step.app.create": "Meta for Developers: create an app",
  "meta.step.app.myApps": "My Apps",

  "meta.step.credentials.title": "Paste the App ID and App Secret, and add the redirect URI",
  "meta.step.credentials.body":
    "In your app: App settings → Basic. Copy the App ID and the App Secret (click Show) into the form below and save. They go into the .env file on this computer as META_APP_ID and META_APP_SECRET; an ENCRYPTION_KEY is created too if there is none (keep a copy of .env).",
  "meta.step.credentials.basic": "App settings → Basic",
  "meta.step.credentials.redirectTitle": "Then add the redirect URI",
  "meta.step.credentials.redirectBody":
    "In your app: Facebook Login for Business → Settings → Valid OAuth Redirect URIs. Add exactly these and save:",
  "meta.step.credentials.loginSettings": "Facebook Login for Business → Settings",
  "meta.step.credentials.localhost":
    "Localhost works while the app is in Development mode. Open this app at http://localhost:3000 (not 127.0.0.1) so the address matches.",
  "meta.step.credentials.configTitle": "Optional: a login configuration",
  "meta.step.credentials.configBody":
    "Facebook Login for Business → Configurations → Create: token type “User access token”, and tick these permissions. Paste its Configuration ID below. Without one, the login asks for the same permissions directly.",
  "meta.step.credentials.configurations": "Facebook Login for Business → Configurations",
  "meta.step.credentials.localOnly":
    "The keys can only be saved when the app runs on this computer (localhost). Online, set META_APP_ID, META_APP_SECRET and ENCRYPTION_KEY in the server's environment.",
  "meta.form.appId": "App ID (META_APP_ID)",
  "meta.form.appSecret": "App Secret (META_APP_SECRET)",
  "meta.form.configId": "Configuration ID (META_LOGIN_CONFIG_ID, optional)",
  "meta.form.keep": "Leave empty to keep the current value",
  "meta.form.clearConfig": "Remove the configuration ID",
  "meta.form.save": "Save",
  "meta.form.saving": "Saving…",
  "meta.form.set": "saved",
  "meta.form.notSet": "not set",
  "meta.form.key": "ENCRYPTION_KEY",

  "meta.step.connect.title": "Connect with Facebook Login for Business",
  "meta.step.connect.body":
    "Click Connect. Log in with the Facebook account that is admin of the app. When Meta asks which Pages and Instagram accounts to share, choose ALL of them, and allow every permission. You come back here when it is done. The login lasts about 60 days; the app warns you a week before it runs out.",
  "meta.step.connect.button": "Connect with Facebook",
  "meta.step.connect.reconnect": "Reconnect",
  "meta.step.connect.needKeys": "Finish step 4 first.",
  "meta.step.connect.as": "Connected as {label}",
  "meta.step.connect.expires": "Login valid until {date}",
  "meta.step.connect.noExpiry": "Login does not expire",
  "meta.step.connect.disconnect": "Disconnect",
  "meta.connected": "Connected. {linked} Instagram account(s) were linked by matching handle.",
  "meta.error": "Meta connection failed: {detail}",

  "meta.step.mapping.title": "Match Pages and Instagram accounts to your accounts here",
  "meta.step.mapping.body":
    "For each Page and Instagram account Meta shares, pick the matching account in this app. Instagram accounts with the same handle are matched for you. An account that is missing here must be added in Accounts first.",
  "meta.step.mapping.auto": "Match by handle",
  "meta.step.mapping.none":
    "Meta shares no Pages yet. Check steps 1–2, then Reconnect and choose all Pages.",
  "meta.step.mapping.connectFirst": "Connect in step 5 to see your Pages and Instagram accounts.",
  "meta.step.mapping.page": "Facebook Page",
  "meta.step.mapping.instagram": "Instagram",
  "meta.step.mapping.noIg": "no Instagram linked to this Page",
  "meta.step.mapping.pick": "— not linked —",
  "meta.step.mapping.save": "Save",

  "meta.sync.title": "Insights",
  "meta.sync.body":
    "“Sync now” pulls the latest numbers for every linked account. To do it daily, schedule “npm run meta:sync” in Windows Task Scheduler.",
  "meta.sync.button": "Sync now",
  "meta.sync.running": "Syncing…",

  "meta.banner.expired":
    "The Meta login has expired or was revoked. Reconnect in step 5. ({detail})",
  "meta.banner.error": "The Meta connection has a problem: {detail}",
  "meta.banner.soon": "{detail}",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "meta.title": "Instagram och Facebook (Meta)",
  "meta.intro":
    "Sex steg kopplar dina Instagram- och Facebookkonton så att appen kan läsa hur dina inlägg går (och senare publicera dem). Gör dem i ordning; varje steg bockas av när appen kan se att det är klart.",
  "meta.state.done": "Klart",
  "meta.state.todo": "Att göra",
  "meta.state.unknown": "Kontrolleras efter steg 5",
  "meta.stillToDo": "Kvar: {list}",
  "meta.openLink": "Öppna",

  "meta.step.professional.title": "Gör varje Instagramkonto till ett professionellt konto",
  "meta.step.professional.body":
    "I Instagram-appen på mobilen, för varje konto: Profil → ☰-menyn → Inställningar och integritet → Kontotyp och verktyg → Byt till professionellt konto. Företag eller Kreatör fungerar båda. Bocka sedan i ”Professionellt” på kontot under Konton.",
  "meta.step.professional.help": "Instagrams hjälp: byt till professionellt konto",
  "meta.step.professional.accounts": "Konton i appen",
  "meta.step.professional.none": "Lägg först till dina Instagramkonton under Konton.",

  "meta.step.pageLink.title": "Koppla varje Instagramkonto till en Facebooksida",
  "meta.step.pageLink.body":
    "Meta låter bara appar läsa Instagram via en Facebooksida, så varje Instagramkonto behöver en egen sida. Ingen sida än? Skapa en (den kan vara nästan tom). Sedan i Instagram: Redigera profil → Sida → Koppla en befintlig sida. Eller från sidan på Facebook: Inställningar → Länkade konton → Instagram → Anslut.",
  "meta.step.pageLink.createPage": "Skapa en Facebooksida",
  "meta.step.pageLink.help": "Instagrams hjälp: koppla en Facebooksida",

  "meta.step.app.title": "Skapa en Meta-utvecklarapp (typ Business)",
  "meta.step.app.body":
    "Gå till Meta for Developers → My Apps → Create app. Logga in med ditt eget Facebookkonto — då blir du appens admin. Välj ”Other” och sedan apptypen ”Business”, och döp den t.ex. till ”Content Engine”. Lägg till produkterna ”Facebook Login for Business” och ”Instagram” i appens dashboard. Låt appen stå kvar i Development mode: ingen annan än du använder den, så inget behöver granskas av Meta. (Appen kan inte se läge eller admins; steget bockas av när App ID är sparat.)",
  "meta.step.app.create": "Meta for Developers: skapa en app",
  "meta.step.app.myApps": "My Apps",

  "meta.step.credentials.title": "Klistra in App ID och App Secret, och lägg till redirect-URI:n",
  "meta.step.credentials.body":
    "I din app: App settings → Basic. Kopiera App ID och App Secret (klicka Show) till formuläret nedan och spara. De sparas i .env-filen på den här datorn som META_APP_ID och META_APP_SECRET; en ENCRYPTION_KEY skapas också om det saknas en (spara en kopia av .env).",
  "meta.step.credentials.basic": "App settings → Basic",
  "meta.step.credentials.redirectTitle": "Lägg sedan till redirect-URI:n",
  "meta.step.credentials.redirectBody":
    "I din app: Facebook Login for Business → Settings → Valid OAuth Redirect URIs. Lägg till exakt dessa och spara:",
  "meta.step.credentials.loginSettings": "Facebook Login for Business → Settings",
  "meta.step.credentials.localhost":
    "Localhost fungerar medan appen är i Development mode. Öppna den här appen på http://localhost:3000 (inte 127.0.0.1) så att adressen stämmer.",
  "meta.step.credentials.configTitle": "Valfritt: en inloggningskonfiguration",
  "meta.step.credentials.configBody":
    "Facebook Login for Business → Configurations → Create: tokentyp ”User access token”, och bocka i dessa behörigheter. Klistra in dess Configuration ID nedan. Utan den ber inloggningen om samma behörigheter direkt.",
  "meta.step.credentials.configurations": "Facebook Login for Business → Configurations",
  "meta.step.credentials.localOnly":
    "Nycklarna kan bara sparas när appen körs på den här datorn (localhost). Online sätter du META_APP_ID, META_APP_SECRET och ENCRYPTION_KEY i serverns miljövariabler.",
  "meta.form.appId": "App ID (META_APP_ID)",
  "meta.form.appSecret": "App Secret (META_APP_SECRET)",
  "meta.form.configId": "Configuration ID (META_LOGIN_CONFIG_ID, valfritt)",
  "meta.form.keep": "Lämna tomt för att behålla nuvarande värde",
  "meta.form.clearConfig": "Ta bort Configuration ID",
  "meta.form.save": "Spara",
  "meta.form.saving": "Sparar…",
  "meta.form.set": "sparad",
  "meta.form.notSet": "inte satt",
  "meta.form.key": "ENCRYPTION_KEY",

  "meta.step.connect.title": "Anslut med Facebook Login for Business",
  "meta.step.connect.body":
    "Klicka Anslut. Logga in med Facebookkontot som är admin för appen. När Meta frågar vilka sidor och Instagramkonton som ska delas, välj ALLA, och tillåt alla behörigheter. Du kommer tillbaka hit när det är klart. Inloggningen gäller i ungefär 60 dagar; appen varnar en vecka innan den går ut.",
  "meta.step.connect.button": "Anslut med Facebook",
  "meta.step.connect.reconnect": "Anslut igen",
  "meta.step.connect.needKeys": "Gör klart steg 4 först.",
  "meta.step.connect.as": "Ansluten som {label}",
  "meta.step.connect.expires": "Inloggningen gäller till {date}",
  "meta.step.connect.noExpiry": "Inloggningen går inte ut",
  "meta.step.connect.disconnect": "Koppla från",
  "meta.connected": "Ansluten. {linked} Instagramkonto(n) kopplades via samma användarnamn.",
  "meta.error": "Anslutningen till Meta misslyckades: {detail}",

  "meta.step.mapping.title": "Para ihop sidor och Instagramkonton med dina konton här",
  "meta.step.mapping.body":
    "För varje sida och Instagramkonto som Meta delar, välj motsvarande konto i appen. Instagramkonton med samma användarnamn paras ihop åt dig. Saknas ett konto här måste det först läggas till under Konton.",
  "meta.step.mapping.auto": "Para ihop via användarnamn",
  "meta.step.mapping.none":
    "Meta delar inga sidor än. Kontrollera steg 1–2, anslut sedan igen och välj alla sidor.",
  "meta.step.mapping.connectFirst": "Anslut i steg 5 för att se dina sidor och Instagramkonton.",
  "meta.step.mapping.page": "Facebooksida",
  "meta.step.mapping.instagram": "Instagram",
  "meta.step.mapping.noIg": "inget Instagramkonto kopplat till sidan",
  "meta.step.mapping.pick": "— inte kopplad —",
  "meta.step.mapping.save": "Spara",

  "meta.sync.title": "Statistik",
  "meta.sync.body":
    "”Synka nu” hämtar de senaste siffrorna för alla kopplade konton. Schemalägg ”npm run meta:sync” i Windows Schemaläggaren för att göra det dagligen.",
  "meta.sync.button": "Synka nu",
  "meta.sync.running": "Synkar…",

  "meta.banner.expired":
    "Inloggningen till Meta har gått ut eller dragits tillbaka. Anslut igen i steg 5. ({detail})",
  "meta.banner.error": "Anslutningen till Meta har ett problem: {detail}",
  "meta.banner.soon": "{detail}",
};
