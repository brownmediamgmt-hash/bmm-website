/* BMM Onboarding — the client intake questions (source: the BMM Onboarding Jotform).
   One definition, used by the intake page (/start), the admin panel and the server (validation + email).
   Types: text · textarea · email · tel · url · name (first+last) · radio · checkbox · file
   other: true → an "Anders" option that asks for a short text. */
(function (root) {
  const INTAKE = {
    version: 1,
    minutes: 15,
    sections: [
      {
        id: 'contact', title: 'Contactgegevens', kicker: 'Wie we spreken',
        steps: [
          [
            { id: 'company', type: 'text', label: 'Bedrijfsnaam', required: true, autocomplete: 'organization' },
            { id: 'contact_name', type: 'name', label: 'Naam contactpersoon', required: true },
            { id: 'role', type: 'text', label: 'Functie', autocomplete: 'organization-title' },
          ],
          [
            { id: 'email', type: 'email', label: 'E-mailadres', required: true, placeholder: 'naam@bedrijf.nl', autocomplete: 'email' },
            { id: 'phone', type: 'tel', label: 'Telefoonnummer', required: true, placeholder: '06 12345678', autocomplete: 'tel' },
            { id: 'website', type: 'url', label: 'Website', placeholder: 'www.jouwbedrijf.nl', autocomplete: 'url' },
          ],
          [
            { id: 'approver', type: 'text', label: 'Wie keurt de video’s goed? Naam en e-mailadres', required: true, placeholder: 'Naam — naam@bedrijf.nl' },
            { id: 'approver_backup', type: 'text', label: 'Wie is de vervanger als die persoon er niet is?', placeholder: 'Naam — naam@bedrijf.nl' },
          ],
        ],
      },
      {
        id: 'bedrijf', title: 'Je bedrijf', kicker: 'Waar het om draait',
        steps: [
          [{ id: 'what_we_do', type: 'textarea', label: 'Wat doet je bedrijf? Leg het uit alsof je het aan een kennis vertelt.', required: true, help: 'Gewoon in je eigen woorden — zo praten je klanten er ook over.' }],
          [{ id: 'best_sellers', type: 'textarea', label: 'Welke producten of diensten leveren je het meeste op?' }],
          [{ id: 'show_parts', type: 'checkbox', label: 'Welke onderdelen van je bedrijf wil je vooral laten zien in de content?', help: 'Kies er zoveel als je wilt.',
            options: ['Producten', 'Diensten', 'De locatie', 'Het team', 'Klanten en resultaten', 'Achter de schermen', 'Evenementen en acties'], other: true }],
          [{ id: 'difference', type: 'textarea', label: 'Wat maakt jullie echt anders dan de concurrent? Wees zo concreet mogelijk.' }],
          [
            { id: 'seasonality', type: 'textarea', label: 'Is er seizoensinvloed? Wanneer is het druk en wanneer rustig?' },
            { id: 'upcoming', type: 'textarea', label: 'Zijn er acties, lanceringen, evenementen of feestdagen in de komende drie maanden die we moeten meenemen?' },
          ],
        ],
      },
      {
        id: 'doelen', title: 'Doelen', kicker: 'Wat het moet opleveren',
        steps: [
          [{ id: 'main_goal', type: 'radio', label: 'Wat is het belangrijkste doel van de content?', required: true,
            options: ['Meer naamsbekendheid in de regio', 'Meer klanten in de winkel of op de locatie', 'Meer online verkopen', 'Meer aanvragen of afspraken', 'Personeel werven', 'Vertrouwen en autoriteit opbouwen'], other: true }],
          [{ id: 'viewer_action', type: 'checkbox', label: 'Waar wil je dat kijkers naartoe gaan nadat ze een video hebben gezien?', required: true,
            options: ['Website of webshop', 'Langskomen in de winkel of op de locatie', 'Bellen', 'Een bericht sturen via WhatsApp of DM', 'Online een afspraak of reservering maken', 'Een offerte aanvragen', 'Ons volgen op social media'], other: true }],
          [{ id: 'success', type: 'textarea', label: 'Wanneer is de samenwerking voor jou een succes? Na drie maanden en na een jaar. Noem het liefst cijfers.', help: 'Bijvoorbeeld: “na 3 maanden 10 aanvragen per maand via Instagram”.' }],
          [{ id: 'report_metrics', type: 'checkbox', label: 'Welke cijfers wil je terugzien in het maandrapport?',
            options: ['Weergaven en bereik', 'Nieuwe volgers', 'Profielbezoeken en klikken naar de website', 'Berichten en aanvragen', 'Verkopen of reserveringen', 'Kosten per aanvraag bij advertenties'] }],
          [{ id: 'lead_source', type: 'radio', label: 'Hoe weet je nu waar nieuwe klanten vandaan komen?',
            options: ['We vragen het aan de klant', 'Via website-statistieken', 'Via het kassasysteem of de webshop', 'Dat meten we nu niet'], other: true }],
        ],
      },
      {
        id: 'klant', title: 'Je klant', kicker: 'Voor wie we maken',
        steps: [
          [{ id: 'ideal_client', type: 'textarea', label: 'Beschrijf je ideale klant. Wie is het, hoe oud ongeveer en waar woont hij of zij?', required: true }],
          [{ id: 'client_area', type: 'radio', label: 'Waar zitten je klanten?',
            options: ['In de buurt, tot ongeveer 25 km', 'In de regio of provincie', 'Heel Nederland', 'Nederland en België', 'Internationaal'] }],
          [{ id: 'best_clients', type: 'textarea', label: 'Beschrijf je drie beste klanten ooit. Waarom waren zij ideaal?' }],
          [{ id: 'faq', type: 'textarea', label: 'Welke vragen stellen klanten het vaakst voordat ze kopen? Noem er minimaal vijf.', help: 'Zet ze onder elkaar — elke vraag kan een video worden.' }],
          [
            { id: 'objections', type: 'textarea', label: 'Waarom koopt iemand soms toch niet? Welke twijfels of bezwaren hoor je?' },
            { id: 'client_words', type: 'textarea', label: 'Welke woorden gebruiken klanten zelf als ze over je product of dienst praten? Denk aan uitspraken uit gesprekken of reviews.' },
          ],
        ],
      },
      {
        id: 'merk', title: 'Merk en stijl', kicker: 'Hoe het moet voelen',
        steps: [
          [
            { id: 'three_words', type: 'text', label: 'Welke drie woorden passen bij hoe je bedrijf moet overkomen?', placeholder: 'Bijv. eerlijk · vakkundig · warm' },
            { id: 'tone', type: 'radio', label: 'Welke toon past het best bij jullie?',
              options: ['Professioneel en zakelijk', 'Vriendelijk en toegankelijk', 'Luchtig met humor', 'Stoer en energiek', 'Luxe en exclusief'] },
          ],
          [
            { id: 'humor', type: 'radio', label: 'Mag er humor in de content?', options: ['Ja graag', 'Een beetje als het past', 'Liever niet'] },
            { id: 'language', type: 'checkbox', label: 'In welke taal moet de content zijn?', options: ['Nederlands', 'Engels'], other: true },
          ],
          [{ id: 'references', type: 'textarea', label: 'Welke video’s of accounts vind je goed, van wie dan ook? Plak de links en vertel wat je aanspreekt.' }],
          [{ id: 'avoid_content', type: 'textarea', label: 'Is er content die je juist niet wilt zien?' }],
          [{ id: 'logo', type: 'file', label: 'Upload je logo en eventuele huisstijl', help: 'PNG, JPG, SVG, PDF, AI/EPS of ZIP · max 10 MB per bestand.' }],
          [{ id: 'competitors', type: 'textarea', label: 'Wie zijn je drie belangrijkste concurrenten? Wat doen zij goed of slecht op social media?' }],
        ],
      },
      {
        id: 'opnames', title: 'Opnames', kicker: 'De filmdag',
        steps: [
          [{ id: 'on_camera', type: 'textarea', label: 'Wie kan er voor de camera? Naam, rol en hoe comfortabel diegene is op camera. Zijn er ook klanten of medewerkers die mee willen doen?' }],
          [{ id: 'locations', type: 'textarea', label: 'Op welke locaties kunnen we filmen?' }],
          [
            { id: 'film_days', type: 'checkbox', label: 'We nemen alle video’s van de maand op één vaste filmdag op. Welke dagen passen daarvoor?',
              options: ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'], compact: true },
            { id: 'film_timing', type: 'radio', label: 'Wanneer in de maand heeft de filmdag je voorkeur?',
              options: ['Begin van de maand', 'Midden van de maand', 'Eind van de maand', 'Maakt niet uit'] },
          ],
          [
            { id: 'proof', type: 'textarea', label: 'Welk bewijs hebben jullie dat jullie goed zijn? Denk aan reviews, cijfers, certificaten, bekende klanten of voor en na.' },
            { id: 'never_show', type: 'textarea', label: 'Wat mag absoluut niet gezegd of getoond worden?' },
          ],
        ],
      },
      {
        id: 'social', title: 'Social media en advertenties', kicker: 'Waar het te zien is',
        steps: [
          [
            { id: 'social_links', type: 'textarea', label: 'Plak de links naar je social media-accounts', placeholder: 'instagram.com/… · tiktok.com/@… · linkedin.com/company/…' },
            { id: 'channels', type: 'checkbox', label: 'Op welke kanalen moeten de video’s komen?', options: ['Instagram', 'Facebook', 'TikTok', 'YouTube Shorts', 'LinkedIn', 'Website'] },
          ],
          [{ id: 'tried_before', type: 'textarea', label: 'Wat heb je eerder geprobeerd op social media? Wat werkte wel en wat niet?' }],
          [
            { id: 'ads_running', type: 'radio', label: 'Adverteer je op Facebook en Instagram?', options: ['Ja, op dit moment', 'Eerder wel, nu niet', 'Nog nooit'] },
            { id: 'ad_account', type: 'radio', label: 'Is er een advertentieaccount met een betaalmethode?', options: ['Ja', 'Nee', 'Weet ik niet'] },
            { id: 'meta_pixel', type: 'radio', label: 'Is de Meta-pixel op je website geïnstalleerd?', options: ['Ja', 'Nee', 'Weet ik niet'] },
          ],
          [{ id: 'ads_budget', type: 'radio', label: 'Welk maandbudget heb je in gedachten voor advertenties, los van onze kosten?',
            options: ['Nog geen', 'Tot 250 euro', '250 tot 500 euro', '500 tot 1000 euro', 'Meer dan 1000 euro', 'Weet ik nog niet'] }],
        ],
      },
      {
        id: 'samenwerking', title: 'Samenwerking', kicker: 'Hoe we werken',
        steps: [
          [
            { id: 'review_mode', type: 'radio', label: 'Hoe wil je meekijken?', options: ['Ik wil elke video vooraf goedkeuren', 'Ik wil de planning zien, jullie mogen plaatsen', 'Een combinatie, dat bespreken we'] },
            { id: 'contact_pref', type: 'checkbox', label: 'Hoe heb je het liefst contact?', options: ['WhatsApp', 'E-mail', 'Bellen', 'Videocall'], compact: true },
          ],
          [
            { id: 'update_freq', type: 'radio', label: 'Hoe vaak wil je een update?', options: ['Wekelijks kort en maandelijks uitgebreid', 'Alleen het maandrapport'] },
            { id: 'anything_else', type: 'textarea', label: 'Is er nog iets dat we moeten weten?' },
          ],
        ],
      },
    ],
  };

  // flat list of questions with their section
  INTAKE.questions = [];
  INTAKE.sections.forEach(sec => sec.steps.forEach(step => step.forEach(q => INTAKE.questions.push(Object.assign({ section: sec.id }, q)))));

  // is a question answered? (shared by page, admin and server)
  INTAKE.isAnswered = function (q, v) {
    if (v == null) return false;
    switch (q.type) {
      case 'name': return !!(v && String(v.first || '').trim() && String(v.last || '').trim());
      case 'checkbox': {
        if (!v || !Array.isArray(v.values)) return false;
        const picked = v.values.filter(x => x !== '__other');
        return picked.length > 0 || (v.values.includes('__other') && String(v.other || '').trim().length > 0);
      }
      case 'radio': return !!(v && (v.value && (v.value !== '__other' || String(v.other || '').trim())));
      case 'file': return Array.isArray(v) && v.length > 0;
      default: return String(v).trim().length > 0;
    }
  };
  // human-readable answer
  INTAKE.formatAnswer = function (q, v) {
    if (!INTAKE.isAnswered(q, v)) return '';
    switch (q.type) {
      case 'name': return (String(v.first).trim() + ' ' + String(v.last).trim()).trim();
      case 'checkbox': {
        const picked = v.values.filter(x => x !== '__other');
        if (v.values.includes('__other') && String(v.other || '').trim()) picked.push('Anders: ' + String(v.other).trim());
        return picked.join(', ');
      }
      case 'radio': return v.value === '__other' ? 'Anders: ' + String(v.other || '').trim() : v.value;
      case 'file': return v.map(f => f.name).join(', ');
      default: return String(v).trim();
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = INTAKE;
  else root.BMM_INTAKE = INTAKE;
})(typeof window !== 'undefined' ? window : this);
