# LBIS Primary CBT

**Product:** LBIS CBT  
**School:** Lead British International School  
**Developer credit:** Designed by TUPS Technologies

This repository contains the browser-based examination system for Lead British International School.

## Supported devices
- Laptops
- Desktop computers
- Tablets (landscape and portrait)

Mobile phones are not supported.

## Locked application requirements
- Student and administrator entry flows.
- Student identity uses Admission Number; class is retrieved from the student record and is not editable.
- Administrator access supports the Teacher and Admin roles.
- Initial examination release supports single-answer multiple-choice questions.
- Randomize question order per candidate; never shuffle answer options.
- Use the numbered question navigator instead of Previous/Next controls.
- Persist answers locally and synchronize them with Supabase.
- Enforce examination deadlines on the server.
- A student has one attempt per examination.
- Teacher-imported Google Forms must be previewed before an examination is published.
- Closing an examination to new candidates must not interrupt candidates already in progress.
- Preserve candidate answers in Supabase independently of Google Forms delivery.
- Google Forms submission is handled through the Apps Script integration; privileged credentials and answer keys must not be exposed to the browser.

## Technology
- Frontend: GitHub Pages
- Database and application services: Supabase
- Google Forms integration: Google Apps Script and Google Forms

## Project structure
The application is being implemented as a modular, static frontend. Page layouts and workflows follow the previously approved LBIS CBT specifications; this scaffold does not redefine those designs.

## Branding
Every application page must identify the product as **LBIS CBT** and include the footer credit:

**Designed by TUPS Technologies**
